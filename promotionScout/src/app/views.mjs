import { effectiveFields } from './derive.mjs';
import { subtopicsOf } from './subtopics.mjs';
import { bestTopic } from './discussions.mjs';

// Read-only projections of SQLite for the web interface. They never change collection or ranking state.

const provenance = `EXISTS (SELECT 1 FROM feed_source_items fs JOIN sources fsrc ON fsrc.id=fs.source
  JOIN project_sources fps ON fps.source=fs.source AND fps.project=t.project
  WHERE fs.item=i.id AND fs.content_hash=i.content_hash AND fsrc.type IN ('automatic','rss','rsshub'))`;
const topicFilter = project => project ? 'AND t.project=?' : '';
const params = (project, ...values) => project ? [...values, project] : values;
const page = (value, fallback, max) => Math.min(max, Math.max(0, Number.parseInt(value, 10) || fallback));

// Default page sizes follow the expected list lengths: few topics and sites, tall result cards,
// compact collected and source rows, and one day of hourly runs.
export const pageSizes = Object.freeze({ topics: 20, sites: 20, results: 25, discussions: 25, items: 50, sources: 50, runs: 24 });
const maxPageSize = 500;
const pageWindow = ({ offset, limit } = {}, size) => ({ offset: page(offset, 0, Number.MAX_SAFE_INTEGER), limit: page(limit, size, maxPageSize) });
function pageOf(rows, paging, size) {
  const { offset, limit } = pageWindow(paging, size);
  return { total: rows.length, offset, limit, items: rows.slice(offset, offset + limit) };
}

export function topicsView(store, paging) {
  const rows = store.db.prepare(`SELECT t.project, t.label, t.topic_key AS key, t.search_terms, t.tags,
    (SELECT COUNT(*) FROM project_sources ps WHERE ps.project=t.project AND ps.enabled=1) AS sources
    FROM topics t WHERE t.active=1 ORDER BY t.topic_key`).all()
    .map(row => {
      const topic = { ...row, search_terms: JSON.parse(row.search_terms), tags: JSON.parse(row.tags) };
      return { ...topic, effective: effectiveFields(topic), subtopics: subtopicsOf(store, row.project) };
    });
  return pageOf(rows, paging, pageSizes.topics);
}

// Each site with the feeds it currently produces for active topics and their latest outcome.
export function sitesView(store, paging) {
  const rows = store.db.prepare(`SELECT st.*,
    (SELECT COUNT(DISTINCT s.id) FROM sources s JOIN project_sources ps ON ps.source=s.id AND ps.enabled=1
      JOIN topics t ON t.project=ps.project AND t.active=1 WHERE s.site=st.id) AS feeds,
    (SELECT COUNT(DISTINCT f.item) FROM feed_source_items f JOIN sources s ON s.id=f.source WHERE s.site=st.id) AS entries,
    (SELECT MAX(s.last_poll) FROM sources s WHERE s.site=st.id) AS last_poll,
    (SELECT COUNT(*) FROM sources s JOIN project_sources ps ON ps.source=s.id AND ps.enabled=1
      JOIN topics t ON t.project=ps.project AND t.active=1 WHERE s.site=st.id AND s.last_error IS NOT NULL) AS failing
    FROM sites st ORDER BY st.builtin DESC, CASE st.kind WHEN 'search' THEN 0 WHEN 'tag' THEN 1 ELSE 2 END, st.name`).all()
    .map(({ options, ...row }) => ({ ...row, builtin: Boolean(row.builtin), enabled: Boolean(row.enabled),
      tagStyle: JSON.parse(options).tagStyle ?? null }));
  return pageOf(rows, paging, pageSizes.sites);
}

export function sourcesView(store, project, paging) {
  const rows = store.db.prepare(`SELECT s.id, s.type, s.locator, s.state, s.last_error, s.last_poll, ps.enabled,
    t.label AS topic, t.project, a.attempted, st.name AS site,
    (SELECT COUNT(*) FROM feed_source_items f WHERE f.source=s.id) AS items
    FROM sources s JOIN project_sources ps ON ps.source=s.id JOIN topics t ON t.project=ps.project AND t.active=1
    LEFT JOIN source_attempts a ON a.source=s.id LEFT JOIN sites st ON st.id=s.site
    WHERE 1=1 ${topicFilter(project)} ORDER BY ps.enabled DESC, t.topic_key, st.name, s.locator`).all(...params(project))
    .map(({ state, attempted, ...row }) => ({ ...row, enabled: Boolean(row.enabled),
      skipped: JSON.parse(state).skipped ?? null, attempted: attempted && new Date(attempted).toISOString() }));
  return pageOf(rows, paging, pageSizes.sources);
}

// Site filters arrive as a comma-separated list of site identifiers.
export function siteFilter(value) {
  return [...new Set(String(value ?? '').split(',').map(part => part.trim()).filter(Boolean))].slice(0, 50);
}

// The sites whose feeds delivered each item; a removed site keeps its identifier as name.
function sitesOf(store, ids) {
  const bySite = new Map(ids.map(id => [id, []]));
  if (!ids.length) return bySite;
  const rows = store.db.prepare(`SELECT DISTINCT si.item, s.site AS id, COALESCE(st.name, s.site) AS name
    FROM source_items si JOIN sources s ON s.id=si.source LEFT JOIN sites st ON st.id=s.site
    WHERE s.site IS NOT NULL AND si.item IN (SELECT value FROM json_each(?)) ORDER BY name`).all(JSON.stringify(ids));
  for (const row of rows) bySite.get(row.item)?.push({ id: row.id, name: row.name });
  return bySite;
}

// Counts per site for the chips, taken before the site filter so every chip keeps its number.
function facetsOf(rows) {
  const counts = new Map();
  for (const row of rows) for (const site of row.sites) {
    const entry = counts.get(site.id) ?? { ...site, count: 0 };
    entry.count++;
    counts.set(site.id, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// Collected feed entries before the relevance threshold, with the current-model score when one exists.
export function itemsView(store, space, { project, offset, limit, threshold, sites = [] } = {}) {
  const { offset: start, limit: size } = pageWindow({ offset, limit }, pageSizes.items);
  const lastRun = store.db.prepare("SELECT started_at FROM runs WHERE status!='running' ORDER BY id DESC LIMIT 1").get();
  const from = `FROM items i JOIN source_items si ON si.item=i.id JOIN project_sources ps ON ps.source=si.source
    JOIN topics t ON t.project=ps.project AND t.active=1 JOIN projects p ON p.name=t.project
    LEFT JOIN evaluations e ON e.project=t.project AND e.item=i.id AND e.space=? AND e.watch_hash=p.watch_hash
      AND e.content_hash=i.content_hash
    WHERE ${provenance} ${topicFilter(project)}`;
  const base = params(project, space);
  const facets = store.db.prepare(`SELECT s.site AS id, COALESCE(st.name, s.site) AS name, COUNT(DISTINCT x.id) AS count
    FROM (SELECT DISTINCT i.id ${from}) x JOIN source_items sx ON sx.item=x.id JOIN sources s ON s.id=sx.source
    LEFT JOIN sites st ON st.id=s.site WHERE s.site IS NOT NULL GROUP BY s.site ORDER BY count DESC, name`).all(...base);
  const siteClause = sites.length ? `AND EXISTS (SELECT 1 FROM source_items sy JOIN sources sz ON sz.id=sy.source
    WHERE sy.item=i.id AND sz.site IN (SELECT value FROM json_each(?)))` : '';
  const filtered = sites.length ? [...base, JSON.stringify(sites)] : base;
  const total = store.db.prepare(`SELECT COUNT(DISTINCT i.id) AS n ${from} ${siteClause}`).get(...filtered).n;
  const all = sites.length ? store.db.prepare(`SELECT COUNT(DISTINCT i.id) AS n ${from}`).get(...base).n : total;
  const rows = store.db.prepare(`SELECT i.id, i.title, substr(i.text,1,500) AS text, i.url, i.platform, i.author,
    i.date, i.fetched_at, i.language, MAX(e.score) AS score, json_group_array(DISTINCT t.label) AS topics ${from} ${siteClause}
    GROUP BY i.id ORDER BY i.fetched_at DESC, i.id LIMIT ? OFFSET ?`).all(...filtered, size, start);
  const names = sitesOf(store, rows.map(row => row.id));
  return { total, all, offset: start, limit: size, threshold, facets, items: rows.map(row => ({
    ...row, topics: JSON.parse(row.topics), sites: names.get(row.id),
    status: !['en', ''].includes(row.language) ? 'not English' : row.score === null ? 'not evaluated'
      : row.score >= threshold ? 'passed' : 'below threshold',
    new: Boolean(lastRun && row.fetched_at >= lastRun.started_at),
  })) };
}

export const resultSorts = Object.freeze({
  new: (a, b) => Number(b.new) - Number(a.new) || b.score - a.score,
  found: (a, b) => String(b.found_at ?? '').localeCompare(String(a.found_at ?? '')) || b.score - a.score,
  score: (a, b) => b.score - a.score,
});

// Every URL that passed the threshold for an active topic; unseen findings are marked new.
export function resultsView(store, space, { project, threshold, onlyNew = false, offset, limit, sites = [], sort = 'new' } = {}) {
  const rows = store.db.prepare(`SELECT i.id, i.title, i.url, i.author, i.date, i.platform, e.score, e.context,
    t.label AS topic, f.run, f.found_at, f.seen_at
    FROM evaluations e JOIN topics t ON t.project=e.project AND t.active=1 JOIN projects p ON p.name=e.project
    JOIN items i ON i.id=e.item AND i.content_hash=e.content_hash LEFT JOIN findings f ON f.url=i.url
    WHERE e.space=? AND e.watch_hash=p.watch_hash AND e.score>=? AND ${provenance} ${topicFilter(project)}`)
    .all(...params(project, space, threshold));
  const byUrl = new Map();
  // Findings are keyed by URL, so every row of one URL shares run, found_at and seen_at.
  for (const { topic, seen_at, ...row } of rows) {
    const old = byUrl.get(row.url);
    const best = !old || row.score > old.score ? row : old;
    byUrl.set(row.url, { ...best, topics: [...new Set([...(old?.topics ?? []), topic])],
      new: Boolean(row.found_at) && !seen_at });
  }
  const order = resultSorts[sort] ?? resultSorts.new;
  const all = [...byUrl.values()].sort((a, b) => order(a, b) || a.url.localeCompare(b.url));
  const names = sitesOf(store, all.map(row => row.id));
  for (const row of all) row.sites = names.get(row.id);
  const newCount = all.filter(row => row.new).length;
  const selected = onlyNew ? all.filter(row => row.new) : all;
  const wanted = new Set(sites);
  const shown = wanted.size ? selected.filter(row => row.sites.some(site => wanted.has(site.id))) : selected;
  return { ...pageOf(shown, { offset, limit }, pageSizes.results), newCount, all: all.length, facets: facetsOf(selected),
    sort: resultSorts[sort] ? sort : 'new' };
}

// Subtopic matches: one row per read discussion, under the best topic it matched in step 3, scored only against that
// topic's subtopics. A discussion matches when its best subtopic reaches the threshold; that subtopic is the winner. A match is
// new from the run that first recorded it until the operator marks it reviewed; opening its link does not change that.
export function discussionsView(store, space, { project, threshold, subtopicThreshold = threshold, show = 'matched', offset,
  limit } = {}) {
  const rows = store.db.prepare(`SELECT DISTINCT i.id, i.url, i.title AS item_title, th.url AS thread_url, th.source, th.title,
    th.post, th.comments, th.content_hash, th.fetched_at, th.error, th.attempts, t.label AS topic, t.project,
    sf.run, sf.found_at, sf.seen_at
    FROM evaluations e JOIN topics t ON t.project=e.project AND t.active=1 JOIN projects p ON p.name=t.project
    JOIN items i ON i.id=e.item AND i.content_hash=e.content_hash JOIN threads th ON th.item=i.id
    LEFT JOIN subtopic_findings sf ON sf.item=i.id AND sf.project=t.project
    WHERE e.space=? AND e.watch_hash=p.watch_hash AND e.score>=? AND EXISTS (SELECT 1 FROM subtopics s WHERE s.project=t.project)
    AND ${bestTopic} ${topicFilter(project)}`).all(...params(project, space, threshold));
  const pending = store.db.prepare(`SELECT COUNT(DISTINCT i.id) AS n
    FROM evaluations e JOIN topics t ON t.project=e.project AND t.active=1 JOIN projects p ON p.name=t.project
    JOIN items i ON i.id=e.item AND i.content_hash=e.content_hash LEFT JOIN threads th ON th.item=i.id
    WHERE e.space=? AND e.watch_hash=p.watch_hash AND e.score>=? AND th.item IS NULL
    AND EXISTS (SELECT 1 FROM subtopics s WHERE s.project=t.project) AND ${bestTopic} ${topicFilter(project)}`).get(...params(project, space, threshold)).n;
  const scoresOf = store.db.prepare(`SELECT st.id, st.text, ts.score, ts.context FROM subtopics st
    LEFT JOIN thread_scores ts ON ts.subtopic=st.id AND ts.item=? AND ts.space=? AND ts.content_hash=?
    WHERE st.project=? ORDER BY ts.score DESC, st.id`);
  const names = sitesOf(store, rows.map(row => row.id));
  // Comments generated before comment generation was removed stay readable, oldest first; nothing adds new ones.
  const generationsOf = store.db.prepare(`SELECT id, comment, agent, model, subtopic, finished_at FROM generations
    WHERE item=? AND project=? AND status='done' AND comment IS NOT NULL ORDER BY id`);
  const all = rows.map(({ comments, item_title, content_hash, seen_at, ...row }) => {
    const scores = row.error ? [] : scoresOf.all(row.id, space, content_hash, row.project)
      .map(score => ({ ...score, passed: score.score !== null && score.score >= subtopicThreshold }));
    const winner = scores.find(score => score.passed) ?? null;
    return { ...row, title: row.title || item_title, comments: JSON.parse(comments),
      sites: names.get(row.id), scores, winner, best: scores[0]?.score ?? null, new: Boolean(winner && row.found_at && !seen_at),
      generations: generationsOf.all(row.id, row.project) };
  }).sort((a, b) => Number(Boolean(b.winner)) - Number(Boolean(a.winner)) || Number(b.new) - Number(a.new)
    || Number(Boolean(a.error)) - Number(Boolean(b.error))
    || (b.best ?? -2) - (a.best ?? -2) || String(b.fetched_at).localeCompare(String(a.fetched_at)));
  const matched = all.filter(row => row.winner);
  const fresh = matched.filter(row => row.new);
  const shown = { all, new: fresh }[show] ?? matched;
  return { ...pageOf(shown, { offset, limit }, pageSizes.discussions),
    matched: matched.length, newCount: fresh.length, all: all.length, pending, threshold: subtopicThreshold };
}

const parseRun = row => ({ ...row, stats: JSON.parse(row.stats), errors: JSON.parse(row.errors) });

export function runsView(store, paging) {
  const { offset, limit } = pageWindow(paging, pageSizes.runs);
  const total = store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n;
  const items = store.db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset).map(parseRun);
  return { total, offset, limit, items };
}

export function latestRun(store) {
  const row = store.db.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT 1').get();
  return row ? parseRun(row) : null;
}
