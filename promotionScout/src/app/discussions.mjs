import { hash, fail } from '../embeddings/config.mjs';
import { cosine } from '../embeddings/index.mjs';
import { fetchThread, threadDefaults, threadHosts } from '../providers/threads.mjs';
import { passages } from './workflows.mjs';

// After ranking, each result belongs to its best topic: the active topic with the highest score (ties go to the
// first label). When that topic has subtopics, Scout reads the discussion behind the result and compares the post
// with its first comments against that topic's subtopics only. Only results reach this stage, never all collected
// entries, and every request goes through the per-host gate.
export const discussionDefaults = Object.freeze({ batchSize: 30, retryMs: 24 * 3600000, maxAttempts: 3 });

// Expects evaluation e, topic t and item i of the current namespace; true when t is the item's best topic.
export const bestTopic = `NOT EXISTS (SELECT 1 FROM evaluations e2 JOIN topics t2 ON t2.project=e2.project AND t2.active=1
  JOIN projects p2 ON p2.name=t2.project WHERE e2.item=e.item AND e2.space=e.space AND e2.watch_hash=p2.watch_hash
  AND e2.content_hash=i.content_hash AND (e2.score>e.score OR (e2.score=e.score AND t2.label<t.label)))`;
const resultCondition = `e.space=? AND e.watch_hash=p.watch_hash AND e.content_hash=i.content_hash AND e.score>=?
  AND EXISTS (SELECT 1 FROM subtopics st WHERE st.project=t.project) AND ${bestTopic}`;
const resultJoins = `FROM evaluations e JOIN topics t ON t.project=e.project AND t.active=1 JOIN projects p ON p.name=t.project
  JOIN items i ON i.id=e.item`;

export function discussionAddress(item) {
  try { return JSON.parse(item.raw_json ?? '{}').discussion_url || item.url; } catch { return item.url; }
}

// Wraps a request function so each call is spaced per host and a refusal pauses that host.
export function gatedRequest(request, gate) {
  return async (address, options) => {
    const host = new URL(address).host;
    if (gate.pausedUntil(host) !== null) throw fail('HOST_PAUSED', `${host} refused requests earlier; paused`);
    await gate.before(host);
    try { return await request(address, options); }
    catch (error) { gate.refused(host, error.status); throw error; }
    finally { gate.after(host); }
  };
}

// Due discussions in reading order: one result of each best topic in turn, newest first within a topic, so a topic
// with many results cannot keep the others waiting.
export function dueDiscussions(store, { now = Date.now(), space, threshold }) {
  const rows = store.db.prepare(`SELECT DISTINCT i.id, i.url, i.raw_json, t.project ${resultJoins}
    LEFT JOIN threads th ON th.item=i.id LEFT JOIN findings f ON f.url=i.url
    WHERE ${resultCondition} AND (th.item IS NULL OR (th.error IS NOT NULL AND th.attempts<? AND th.attempted<?))
    ORDER BY COALESCE(f.found_at, i.fetched_at) DESC, i.id`)
    .all(space, threshold, discussionDefaults.maxAttempts, now - discussionDefaults.retryMs);
  const byTopic = Map.groupBy(rows, row => row.project);
  const queues = [...byTopic.values()];
  const order = [];
  for (let index = 0; order.length < rows.length; index++) {
    for (const queue of queues) if (index < queue.length) order.push(queue[index]);
  }
  return order;
}

// Reads the given discussions. A discussion whose host is paused after a refusal is deferred without using one of its
// attempts, since no request was made; it is read in a later run, after the pause.
export async function collectDiscussions(store, items, { request, gate, now = Date.now(), signal, report = () => {} }) {
  const stats = { fetched: 0, failed: 0, deferred: 0 };
  const polite = gatedRequest(request, gate);
  const previousOf = store.db.prepare('SELECT attempted, attempts, error FROM threads WHERE item=?');
  for (const item of items) {
    signal?.throwIfAborted();
    const url = discussionAddress(item);
    if (threadHosts(url).some(host => gate.pausedUntil(host) !== null)) { stats.deferred++; continue; }
    const previous = previousOf.get(item.id);
    store.db.prepare(`INSERT INTO threads(item,url,attempted,attempts,error) VALUES(?,?,?,1,'Reading was interrupted')
      ON CONFLICT(item) DO UPDATE SET url=excluded.url, attempted=excluded.attempted, attempts=attempts+1,
      error='Reading was interrupted'`).run(item.id, url, now);
    try {
      const thread = await fetchThread(url, polite);
      const contentHash = hash(JSON.stringify([thread.title, thread.post, thread.comments]));
      store.db.prepare(`UPDATE threads SET source=?, title=?, post=?, comments=?, content_hash=?, fetched_at=?, error=NULL
        WHERE item=?`).run(thread.source, thread.title, thread.post, JSON.stringify(thread.comments), contentHash,
        new Date().toISOString(), item.id);
      stats.fetched++;
      report(`Read discussion: ${url} (${thread.source}, ${thread.comments.length} comment(s))`);
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error.code === 'HOST_PAUSED') {
        // A host paused during this read (for example the page fallback's host) was not contacted: undo the attempt.
        if (previous) store.db.prepare('UPDATE threads SET attempted=?, attempts=?, error=? WHERE item=?')
          .run(previous.attempted, previous.attempts, previous.error, item.id);
        else store.db.prepare('DELETE FROM threads WHERE item=?').run(item.id);
        stats.deferred++;
        continue;
      }
      store.db.prepare('UPDATE threads SET error=? WHERE item=?').run(error.message, item.id);
      stats.failed++;
      report(`Discussion not read: ${url}: ${error.message}`);
    }
  }
  return stats;
}

// Reads every due discussion in batches; after each batch the read discussions are scored, so subtopic matches appear
// while a long run continues and work done before a Stop is kept.
export async function readAndScoreDiscussions(store, service, options) {
  const { report = () => {} } = options;
  const due = dueDiscussions(store, options);
  const totals = { fetched: 0, failed: 0, deferred: 0, scored: 0, matched: 0, newMatches: 0 };
  const batches = Math.ceil(due.length / discussionDefaults.batchSize);
  if (due.length) report(`Reading ${due.length} discussion(s) of results with subtopics in ${batches} batch(es)`);
  for (let batch = 0; batch < batches; batch++) {
    const items = due.slice(batch * discussionDefaults.batchSize, (batch + 1) * discussionDefaults.batchSize);
    const read = await collectDiscussions(store, items, options);
    const scored = await scoreDiscussions(store, service, options);
    for (const [key, value] of Object.entries({ ...read, ...scored })) totals[key] += value;
    report(`Discussions batch ${batch + 1} of ${batches}: ${read.fetched} read, ${read.failed} failed, `
      + `${read.deferred} deferred, ${scored.newMatches} new subtopic match(es)`);
  }
  if (!due.length) Object.assign(totals, await scoreDiscussions(store, service, options));
  return totals;
}

// The text compared with subtopics: title, post and the first comments, as one passage when it fits the model.
export const threadText = thread => [thread.title, thread.post, ...JSON.parse(thread.comments ?? '[]')
  .slice(0, threadDefaults.comments)].filter(Boolean).join('\n');

export async function scoreDiscussions(store, service, { space, threshold, subtopicThreshold = threshold, run = null, signal,
  report = () => {} }) {
  const stats = { scored: 0, matched: 0, newMatches: 0 };
  const matched = new Set();
  // Each discussion is compared only with the subtopics of its best topic.
  const pairs = store.db.prepare(`SELECT DISTINCT th.item, th.title, th.post, th.comments, th.content_hash, st.id AS subtopic,
    st.text AS subtopic_text, t.project ${resultJoins} JOIN threads th ON th.item=i.id AND th.error IS NULL
    JOIN subtopics st ON st.project=t.project
    LEFT JOIN thread_scores ts ON ts.item=th.item AND ts.subtopic=st.id AND ts.space=? AND ts.content_hash=th.content_hash
    WHERE ${resultCondition} AND ts.item IS NULL ORDER BY th.item`).all(space, space, threshold);
  if (pairs.length) report(`Scoring ${pairs.length} discussion/subtopic pair(s)`);
  const vectors = new Map(), chunks = new Map();
  const insert = store.db.prepare('INSERT OR REPLACE INTO thread_scores VALUES(?,?,?,?,?,?,?)');
  for (const pair of pairs) {
    signal?.throwIfAborted();
    if (!vectors.has(pair.subtopic)) vectors.set(pair.subtopic, (await service.embed([pair.subtopic_text], 'query'))[0]);
    if (!chunks.has(pair.item)) chunks.set(pair.item, await passages(service, threadText(pair)));
    const query = vectors.get(pair.subtopic);
    const best = chunks.get(pair.item).map(chunk => ({ score: cosine(query, chunk.vector), context: chunk.text }))
      .sort((a, b) => b.score - a.score)[0];
    insert.run(pair.item, pair.subtopic, space, pair.content_hash, best.score, best.context.slice(0, 600), new Date().toISOString());
    stats.scored++;
    if (best.score >= subtopicThreshold) matched.add(`${pair.item}\n${pair.project}`);
  }
  stats.matched = matched.size;
  // Every discussion and topic pair that currently has a matching subtopic is recorded once; the first record makes it new.
  const winners = store.db.prepare(`SELECT DISTINCT i.id AS item, t.project ${resultJoins}
    JOIN threads th ON th.item=i.id AND th.error IS NULL
    JOIN subtopics st ON st.project=t.project
    JOIN thread_scores ts ON ts.item=th.item AND ts.subtopic=st.id AND ts.space=? AND ts.content_hash=th.content_hash
    WHERE ${resultCondition} AND ts.score>=?`).all(space, space, threshold, subtopicThreshold);
  stats.newMatches = store.saveSubtopicFindings(run, winners);
  return stats;
}
