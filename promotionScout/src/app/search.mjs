import { setTimeout as delay } from 'node:timers/promises';
import { createHostGate, politeDefaults } from './polite.mjs';
import { activeTopics } from './topics.mjs';
import { evaluateProject } from './workflows.mjs';
import { enabledSites, siteSources } from './sites.mjs';
import { plain } from './normalize.mjs';
import { detectLanguage, rankedLanguages } from './language.mjs';
import { pollFeed } from '../providers/feeds.mjs';
import { createHttp, endpoint } from '../providers/http.mjs';
import { readAndScoreDiscussions } from './discussions.mjs';

export const searchDefaults = Object.freeze({ pollMs: 3600000, days: 7, ...politeDefaults });

const cleaner = patterns => {
  const expressions = (patterns ?? []).map(pattern => new RegExp(pattern, 'gm'));
  return text => expressions.reduce((value, expression) => value.replace(expression, ' '), plain(text))
    .replace(/\s+/g, ' ').trim();
};

// Points every active topic at the feeds its enabled sites produce; feeds no longer produced stay stored but inactive.
export function selectSources(store, topics, sites) {
  let count = 0;
  for (const topic of topics) {
    const wanted = sites.flatMap(site => siteSources(site, topic).map(source => ({ ...source, site: site.id })));
    const ids = wanted.map(source => store.addSource(topic.project, source.type, source.locator, source.site).id);
    store.transaction(() => {
      store.db.prepare('UPDATE project_sources SET enabled=0 WHERE project=?').run(topic.project);
      for (const id of ids) store.db.prepare('UPDATE project_sources SET enabled=1 WHERE project=? AND source=?')
        .run(topic.project, id);
    });
    count += ids.length;
  }
  return count;
}

// One collection and ranking cycle across active topics. Returns every passing result of this cycle.
export async function searchTopics(store, service, settings, {
  now = Date.now(), report = () => {}, signal, topics = activeTopics(store), sites = enabledSites(store),
  request = createHttp(settings, fetch, signal), run = null, ensureRsshub = async () => {}, wait = delay,
  threshold = service.threshold,
} = {}) {
  if (typeof threshold !== 'number') throw new TypeError('A relevance threshold is required');
  const errors = [];
  const stats = { topics: topics.length, sources: 0, polled: 0, skipped: 0, failed: 0,
    newItems: 0, notEnglish: 0, evaluated: 0, passed: 0, newResults: 0 };
  const problem = (context, error) => {
    const message = `${context}: ${error.message ?? error}`;
    errors.push(message); report(message);
  };
  selectSources(store, topics, sites);
  const siteById = new Map(sites.map(site => [site.id, site]));
  const sources = new Map(topics.flatMap(topic => store.sources(topic.project, true)).map(source => [source.id, source]));
  stats.sources = sources.size;
  report(`Collecting ${sources.size} feed(s) from ${sites.length} site(s) for ${topics.length} topic(s)`);
  // A refusing host is left alone for hours; its feeds keep no attempt and stay due.
  const gate = createHostGate(store, { now, wait, signal });
  let rsshub;
  for (const source of sources.values()) {
    signal?.throwIfAborted();
    const site = siteById.get(source.site);
    const state = JSON.parse(source.state);
    const previous = store.db.prepare('SELECT attempted FROM source_attempts WHERE source=?').get(source.id);
    if (previous && now - previous.attempted < searchDefaults.pollMs) {
      if (source.last_error) { problem(source.locator, source.last_error); stats.failed++; }
      else if (state.skipped) { report(`Skipping: ${source.locator}: ${state.skipped} (cached)`); stats.skipped++; }
      continue;
    }
    const url = source.type === 'rsshub' ? endpoint(settings.rsshubUrl, source.locator.slice(1)).href : source.locator;
    const host = new URL(url).host;
    const until = gate.pausedUntil(host);
    if (until !== null) {
      report(`Skipping: ${source.locator}: ${host} refused requests; paused until ${new Date(until).toISOString()}`);
      stats.skipped++;
      continue;
    }
    if (source.type === 'rsshub') {
      rsshub ??= ensureRsshub().then(() => null, error => error);
      const unavailable = await rsshub;
      if (unavailable) { problem(source.locator, `RSSHub unavailable: ${unavailable.message}`); stats.failed++; continue; }
    }
    await gate.before(host, site?.options.delayMs);
    store.transaction(() => {
      store.db.prepare('INSERT OR REPLACE INTO source_attempts VALUES(?,?)').run(source.id, now);
      store.db.prepare('UPDATE sources SET last_error=? WHERE id=?')
        .run('Previous poll was interrupted; retry after the polling interval.', source.id);
    });
    try {
      report(`Collecting feed: ${source.locator}`);
      const result = await pollFeed(url, state, request);
      const clean = cleaner(site?.options.remove);
      // Entries with neither title nor text (for example image-only posts) give the model nothing to compare.
      const items = result.items.map(item => ({ ...item, text: clean(item.text) }))
        .filter(item => item.text || plain(item.title));
      const empty = result.items.length - items.length;
      // Non-English entries stay stored with their language but are never ranked.
      for (const item of items) item.language = await detectLanguage(plain(item.title), item.text);
      const foreign = items.filter(item => !rankedLanguages.includes(item.language)).length;
      const added = store.ingest(source, items, result.state, { feed: true });
      stats.polled++; stats.newItems += added; stats.notEnglish += foreign;
      report(`Collected: ${source.locator}: ${items.length} entr${items.length === 1 ? 'y' : 'ies'}, ${added} new`
        + (empty ? `, ${empty} without text skipped` : '') + (foreign ? `, ${foreign} not in English` : ''));
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      gate.refused(host, error.status);
      // An unknown tag or community is an explicit skip, not a failure; Lemmy answers 400 where others answer 404.
      if (site?.kind === 'tag' && [400, 404, 410].includes(error.status)) {
        store.ingest(source, [], { skipped: 'Tag not found on this site' }, { feed: true });
        report(`Skipping: ${source.locator}: tag not found on this site`);
        stats.skipped++;
      } else {
        store.db.prepare('UPDATE sources SET last_error=? WHERE id=?').run(error.message, source.id);
        problem(source.locator, error);
        stats.failed++;
      }
    } finally { gate.after(host); }
  }
  const byUrl = new Map();
  for (const topic of topics) {
    signal?.throwIfAborted();
    report(`Ranking: ${topic.label}`);
    const { evaluations, watch } = await evaluateProject(store, service, topic.project, searchDefaults.days,
      { feedOnly: true, signal });
    store.saveEvaluations(topic.project, service.space, evaluations, watch.watch_hash);
    stats.evaluated += evaluations.length;
    for (const row of evaluations) {
      if (row.score < threshold) continue;
      const old = byUrl.get(row.url);
      const labels = [...new Set([...(old?.topics ?? []), topic.label])];
      const selected = !old || row.score > old.score ? { id: row.id, url: row.url, title: row.title, score: row.score } : old;
      byUrl.set(row.url, { ...selected, topics: labels });
    }
  }
  const rows = [...byUrl.values()].sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
  stats.passed = rows.length;
  if (run !== null) stats.newResults = store.saveFindings(run, rows);
  // Discussions are read and compared with subtopics only when some topic has subtopics.
  if (store.db.prepare('SELECT 1 FROM subtopics LIMIT 1').get()) {
    const options = { request, gate, now, space: service.space, threshold, run, signal, report,
      subtopicThreshold: service.subtopicThreshold ?? threshold };
    const done = await readAndScoreDiscussions(store, service, options);
    Object.assign(stats, { threadsRead: done.fetched, threadsFailed: done.failed, threadsDeferred: done.deferred,
      threadsScored: done.scored, subtopicMatches: done.matched, newSubtopicMatches: done.newMatches });
  }
  return { rows, errors, stats };
}
