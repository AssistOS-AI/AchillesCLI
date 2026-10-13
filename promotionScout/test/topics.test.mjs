import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/app/store.mjs';
import { saveTopic, updateTopic, activeTopics } from '../src/app/topics.mjs';
import { searchTopics, selectSources } from '../src/app/search.mjs';
import { loadSiteCatalog, syncCatalog, siteSources, normalizeTag, validateSite, addSite, deleteSite,
  setSiteEnabled, enabledSites } from '../src/app/sites.mjs';
import { defaults } from '../src/app/config.mjs';

const site = (id, kind, template, options = {}) => ({ id, name: id, kind, template, options });
const rss = (count, version = 1) => '<rss version="2.0"><channel>' + Array.from({ length: count }, (_, i) =>
  `<item><guid>${i}</guid><title>Movie ${i}</title><link>https://example.org/${i}</link><description>Version ${version}</description></item>`)
  .join('') + '</channel></rss>';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'scout-topics-'));
  const store = await openStore(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  let version = 1, failFeed = false;
  const urls = [];
  let embeddings = 0;
  const service = { space: 'test', threshold: 0.75, async embed(texts) { embeddings += texts.length; return texts.map(() => [1, 0]); } };
  const request = async url => {
    urls.push(String(url));
    if (failFeed) throw new Error('feed unavailable');
    return { body: rss(version === 1 ? 25 : 26, version) };
  };
  const run = (options = {}) => searchTopics(store, service, defaults, { request, wait: async () => {}, ...options });
  return { dir, store, service, request, run, urls, embeddings: () => embeddings,
    change: () => version++, fail: () => failFeed = true };
}

test('topics normalize duplicates, keep search terms and tags, deactivate and restore', async t => {
  const { store } = await fixture(t);
  assert.equal(saveTopic(store, '  Sci   Fi Movies  ', false, { searchTerms: ['space opera', 'Space  Opera', ''], tags: ['scifi'] }).status, 'added');
  assert.equal(saveTopic(store, 'sci fi movies').status, 'already exists');
  let [topic] = activeTopics(store);
  assert.deepEqual([topic.search_terms, topic.tags], [['space opera'], ['scifi']]);
  updateTopic(store, 'SCI FI MOVIES', { searchTerms: ['film'], tags: [] });
  [topic] = activeTopics(store);
  assert.deepEqual([topic.search_terms, topic.tags], [['film'], []]);
  assert.throws(() => updateTopic(store, 'sci fi movies', { tags: ['a', 'b', 'c', 'd', 'e', 'f'] }), { code: 'INPUT_INVALID' });
  saveTopic(store, 'SCI FI MOVIES', true);
  assert.equal(activeTopics(store).length, 0);
  assert.equal(saveTopic(store, 'sci fi movies').status, 'restored');
  assert.deepEqual(activeTopics(store)[0].search_terms, ['film']);
  assert.equal(store.projects().length, 1);
});

test('sites turn search terms, tags and fixed feeds into concrete feeds', () => {
  const topic = { label: 'Balcony vegetable gardening', search_terms: [], tags: ['Balcony Garden', 'C++ tips'] };
  // Without stored search terms the description's significant words are sent.
  assert.deepEqual(siteSources(site('s', 'search', 'https://x.org/s.rss?q={query}'), topic),
    [{ type: 'rss', locator: 'https://x.org/s.rss?q=balcony%20vegetable%20gardening' }]);
  assert.deepEqual(siteSources(site('r', 'search', 'https://r.org/search.rss?q={query}', { joinTerms: ' OR ' }),
    { ...topic, search_terms: ['balcony garden', 'tomatoes'] }),
  [{ type: 'rss', locator: 'https://r.org/search.rss?q=(balcony%20garden)%20OR%20tomatoes' }]);
  assert.deepEqual(siteSources(site('b', 'search', '/bsky/keyword/{query}'), { ...topic, search_terms: ['a b', 'c'] }),
    [{ type: 'rsshub', locator: '/bsky/keyword/a%20b' }, { type: 'rsshub', locator: '/bsky/keyword/c' }]);
  assert.deepEqual(siteSources(site('m', 'tag', 'https://m.org/tag/{tag}', { tagStyle: 'hyphen' }), topic)
    .map(row => row.locator), ['https://m.org/tag/balcony-garden', 'https://m.org/tag/c-tips']);
  assert.deepEqual(siteSources(site('t', 'tag', 'https://t.org/t/{tag}.rss'), { ...topic, tags: [] }).map(row => row.locator),
    ['https://t.org/t/balcony.rss', 'https://t.org/t/vegetable.rss', 'https://t.org/t/gardening.rss']);
  assert.deepEqual(siteSources(site('f', 'feed', 'https://f.org/feed'), topic), [{ type: 'rss', locator: 'https://f.org/feed' }]);
  assert.equal(normalizeTag('Grădinărit urban', 'joined'), 'grădinăriturban');
  assert.equal(normalizeTag('Grădinărit urban', 'alnum'), 'grdinriturban');
  assert.equal(normalizeTag('Linux gaming', 'underscore'), 'linux_gaming'); // Lemmy community names.
  assert.throws(() => validateSite({ name: 'x', kind: 'search', template: 'https://x.org/feed' }), { code: 'INPUT_INVALID' });
  assert.throws(() => validateSite({ name: 'x', kind: 'feed', template: 'https://x.org/{tag}' }), { code: 'INPUT_INVALID' });
  assert.throws(() => validateSite({ name: 'x', kind: 'feed', template: '//evil/../x' }), { code: 'INPUT_INVALID' });
});

test('search terms and tags are derived from short topics and stored lists override them', async () => {
  const { deriveFields, effectiveFields } = await import('../src/app/derive.mjs');
  assert.deepEqual(deriveFields('AI gaming news'), { searchTerms: ['ai gaming'], tags: ['ai gaming', 'ai', 'gaming'] });
  assert.deepEqual(deriveFields('news on ai in gaming'), deriveFields('AI gaming news'));
  assert.deepEqual(deriveFields('Steam Deck Linux gaming'),
    { searchTerms: ['steam deck', 'linux gaming'], tags: ['steam deck', 'linux gaming', 'steam', 'deck', 'linux'] });
  assert.deepEqual(deriveFields('pc components for a mid budget gaming pc').tags, ['pc components', 'pc', 'components', 'budget', 'gaming']);
  assert.deepEqual(deriveFields('the news in 2026'), { searchTerms: [], tags: [] });
  assert.deepEqual(effectiveFields({ label: 'the news in 2026', search_terms: [], tags: [] }).searchTerms, ['the news in 2026']);
  const stored = effectiveFields({ label: 'AI gaming news', search_terms: ['npc ai'], tags: [] });
  assert.deepEqual([stored.searchTerms, stored.derivedTerms, stored.derivedTags], [['npc ai'], false, true]);
  assert.equal(siteSources(site('m', 'tag', 'https://m.social/tags/{tag}.rss'), { label: 'linux gaming', search_terms: [], tags: [] })[0].locator,
    'https://m.social/tags/linuxgaming.rss');
});

test('the built-in catalog is valid, synchronized once and keeps the operator enable choice', async t => {
  const { store } = await fixture(t);
  const catalog = await loadSiteCatalog();
  assert.ok(catalog.length >= 10);
  assert.deepEqual([...new Set(catalog.map(row => row.kind))].sort(), ['feed', 'search', 'tag']);
  syncCatalog(store, catalog);
  setSiteEnabled(store, 'reddit', false);
  syncCatalog(store, catalog);
  assert.equal(enabledSites(store).some(row => row.id === 'reddit'), false);
  assert.throws(() => deleteSite(store, 'medium'), { code: 'SITE_BUILTIN' });
  const added = await addSite(store, { name: 'Forum', kind: 'search', template: 'https://forum.example/search.rss?q={query}' });
  assert.equal(enabledSites(store).find(row => row.id === added.id).kind, 'search');
  await assert.rejects(addSite(store, { name: 'Again', kind: 'search', template: 'https://forum.example/search.rss?q={query}' }),
    { code: 'SITE_EXISTS' });
  deleteSite(store, added.id);
});

test('one cycle polls a shared feed once, ranks every topic and respects the hourly interval', async t => {
  const f = await fixture(t);
  saveTopic(f.store, 'movies'); saveTopic(f.store, 'science fiction');
  const sites = [site('news', 'feed', 'https://example.org/feed')];
  const now = Date.now();
  let result = await f.run({ now, sites, run: f.store.startRun() });
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows.length, 25);
  assert.equal(result.rows[0].topics.length, 2);
  assert.deepEqual([result.stats.sources, result.stats.polled, result.stats.newItems, result.stats.newResults], [1, 1, 25, 25]);
  assert.equal(f.urls.length, 1);
  const embeds = f.embeddings();
  result = await f.run({ now: now + 2, sites, run: f.store.startRun() });
  assert.equal(result.stats.newResults, 0); // Findings are recorded once per URL.
  assert.equal(f.urls.length, 1);
  assert.equal(f.embeddings(), embeds + 2); // Only query lookups, no document evaluation.
  f.change();
  result = await f.run({ now: now + 3600000, sites, run: f.store.startRun() });
  assert.deepEqual([f.urls.length, result.stats.newItems, result.stats.newResults], [2, 1, 1]);
});

test('changing terms replaces a topic feed set and keeps old feeds stored but inactive', async t => {
  const f = await fixture(t);
  saveTopic(f.store, 'movies', false, { searchTerms: ['film'] });
  const sites = [site('s', 'search', 'https://example.org/search.rss?q={query}')];
  selectSources(f.store, activeTopics(f.store), sites);
  updateTopic(f.store, 'movies', { searchTerms: ['cinema'] });
  selectSources(f.store, activeTopics(f.store), sites);
  const project = activeTopics(f.store)[0].project;
  assert.deepEqual(f.store.sources(project).map(row => [row.locator.split('=')[1], row.enabled]).sort(),
    [['cinema', 1], ['film', 0]]);
});

test('a 429 pauses that host for hours without recording attempts for skipped feeds', async t => {
  const f = await fixture(t);
  saveTopic(f.store, 'movies', false, { searchTerms: ['a', 'b', 'c'] });
  const sites = [site('r', 'search', 'https://limited.example/search.rss?q={query}', { delayMs: 5000 }),
    site('ok', 'feed', 'https://example.org/feed')];
  const calls = [], waits = [];
  const request = async url => {
    calls.push(String(url));
    if (new URL(url).host === 'limited.example') throw Object.assign(new Error('limited.example: HTTP 429'), { code: 'RATE_LIMITED', status: 429 });
    return f.request(url);
  };
  const result = await f.run({ sites, request, wait: async ms => { waits.push(ms); } });
  assert.equal(calls.filter(url => url.includes('limited.example')).length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.stats.skipped, 2);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM source_attempts').get().n, 2); // The 429 feed and the other host.
  assert.equal(result.rows.length, 25);
  assert.ok(waits.every(ms => ms > 0));
  // The refusing host stays paused for hours, even when its feeds are due again.
  const later = await f.run({ sites, request, now: Date.now() + 3600000, wait: async () => {} });
  assert.equal(calls.filter(url => url.includes('limited.example')).length, 1);
  assert.equal(later.stats.skipped, 3);
});

test('requests to one host are spaced by the site delay', async t => {
  const f = await fixture(t);
  saveTopic(f.store, 'movies', false, { searchTerms: ['a', 'b'] });
  const waits = [];
  await f.run({ sites: [site('r', 'search', 'https://example.org/search.rss?q={query}', { delayMs: 10000 })],
    wait: async ms => { waits.push(ms); } });
  assert.equal(waits.length, 1);
  assert.ok(waits[0] > 9000 && waits[0] <= 10000);
});

test('unknown tags are explicit skips and RSSHub starts only for RSSHub feeds', async t => {
  const f = await fixture(t);
  saveTopic(f.store, 'movies', false, { tags: ['nosuchtag'] });
  let started = 0;
  const request = async url => {
    if (String(url).includes('/t/nosuchtag')) throw Object.assign(new Error('HTTP 404'), { code: 'HTTP_ERROR', status: 404 });
    if (String(url).includes('/c/nosuchtag')) throw Object.assign(new Error('HTTP 400'), { code: 'HTTP_ERROR', status: 400 });
    return f.request(url);
  };
  let result = await f.run({ request, ensureRsshub: async () => { started++; },
    sites: [site('tags', 'tag', 'https://tags.example/t/{tag}.rss'), site('community', 'tag', 'https://lemmy.example/feeds/c/{tag}.xml'),
      site('plain', 'feed', 'https://example.org/feed')] });
  assert.deepEqual([result.errors, result.stats.skipped, started], [[], 2, 0]); // Lemmy answers 400 for unknown communities.
  saveTopic(f.store, 'shows');
  result = await f.run({ request, ensureRsshub: async () => { started++; throw new Error('not installed'); },
    sites: [site('hub', 'feed', '/huggingface/daily-papers'), site('other', 'feed', 'https://other.example/feed')] });
  assert.equal(started, 1); // Started on demand, once per run.
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /RSSHub unavailable: not installed/);
  assert.equal(result.stats.polled, 1); // The non-RSSHub feed still ran.
});

test('failed polls preserve state and remain explicit during the hourly cooldown', async t => {
  const f = await fixture(t); saveTopic(f.store, 'movies');
  const sites = [site('news', 'feed', 'https://example.org/feed')];
  const now = Date.now();
  await f.run({ now, sites }); f.fail();
  const result = await f.run({ now: now + 3600001, sites });
  assert.equal(result.errors.length, 1);
  const before = f.urls.length;
  assert.equal((await f.run({ now: now + 3600002, sites })).errors.length, 1);
  assert.equal(f.urls.length, before);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM items').get().n, 25);
});

test('inference failure records no findings and uses no alternate ranking', async t => {
  const f = await fixture(t); saveTopic(f.store, 'movies');
  f.service.embed = async () => { throw new Error('inference failed'); };
  await assert.rejects(f.run({ sites: [site('news', 'feed', 'https://example.org/feed')], run: f.store.startRun() }), /inference failed/);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM findings').get().n, 0);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM evaluations').get().n, 0);
});

test('a stopped cycle aborts between requests without recording a provider failure', async t => {
  const f = await fixture(t); saveTopic(f.store, 'movies');
  const controller = new AbortController();
  const request = async () => {
    controller.abort(Object.assign(new Error('Monitoring was stopped'), { code: 'ABORTED' }));
    throw new Error('request cancelled');
  };
  await assert.rejects(f.run({ request, signal: controller.signal, sites: [site('news', 'feed', 'https://example.org/feed')] }),
    { code: 'ABORTED' });
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM items').get().n, 0);
});

test('feed entries keep only cleaned text and never fall back to HTML', async t => {
  const f = await fixture(t); saveTopic(f.store, 'movies');
  const request = async () => ({ body: '<rss version="2.0"><channel><item><title>Post</title><link>https://example.org/p</link>'
    + '<description>Article URL: https://x.org Comments URL: https://y.org Points: 3 Useful text</description></item></channel></rss>' });
  await f.run({ request, sites: [site('hn', 'search', 'https://hn.example/newest?q={query}',
    { remove: ['Article URL: \\S+', 'Comments URL: \\S+', 'Points: \\d+'] })] });
  assert.equal(f.store.db.prepare('SELECT text FROM items').get().text, 'Useful text');
  const imageOnly = async () => ({ body: '<rss version="2.0"><channel><item><title>Kept</title><link>https://example.org/k</link></item>'
    + '<item><link>https://example.org/image-only</link><description><![CDATA[<img src="x.png">]]></description></item></channel></rss>' });
  const partial = await f.run({ request: imageOnly, now: Date.now() + 3600000, sites: [site('m', 'feed', 'https://m.example/feed')] });
  assert.deepEqual([partial.errors, partial.stats.newItems], [[], 1]);
  const html = async () => ({ body: '<html><title>Page</title><body>Menu</body></html>' });
  const result = await f.run({ request: html, now: Date.now() + 7200000, sites: [site('page', 'feed', 'https://example.org/page')] });
  assert.equal(result.errors.length, 1);
  assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM items').get().n, 2);
});

test('non-English entries are stored, shown and never ranked; short English titles are kept', async t => {
  const { detectLanguage } = await import('../src/app/language.mjs');
  for (const title of ['Tomatoes on a balcony', 'Goodbye Google', 'GPU Glossary']) assert.equal(await detectLanguage(title, ''), '');
  assert.equal(await detectLanguage('Google und Unity stellen Plattformen zur Spieleentwicklung mittels generativer KI vor', ''), 'de');
  assert.notEqual(await detectLanguage('ドイツでGeForce RTX 50が平均66%高騰、16GBを選ぶ追加負担も拡大', ''), '');
  const f = await fixture(t); saveTopic(f.store, 'movies');
  const request = async () => ({ body: '<rss version="2.0"><channel>'
    + '<item><title>Tomatoes on a balcony</title><link>https://example.org/en</link></item>'
    + '<item><title>Arrivano i tatuaggi che si accendono e si spengono con la luce, ideati da un designer</title>'
    + '<link>https://example.org/it</link></item></channel></rss>' });
  const result = await f.run({ request, sites: [site('news', 'feed', 'https://example.org/feed')] });
  assert.deepEqual([result.stats.newItems, result.stats.notEnglish, result.stats.evaluated], [2, 1, 1]);
  const { itemsView } = await import('../src/app/views.mjs');
  assert.deepEqual(itemsView(f.store, 'test', { threshold: 0.75 }).items.map(row => row.status).sort(), ['not English', 'passed']);
});

test('results and collected entries can be filtered by site with per-site counts and sorted', async t => {
  const f = await fixture(t); saveTopic(f.store, 'movies');
  const { resultsView, itemsView } = await import('../src/app/views.mjs');
  const feed = (prefix, count) => ({ body: '<rss version="2.0"><channel>' + Array.from({ length: count }, (_, i) =>
    `<item><guid>${prefix}${i}</guid><title>Movie review ${prefix}${i}</title><link>https://${prefix}.example/${i}</link></item>`).join('')
    + '</channel></rss>' });
  const request = async url => feed(new URL(url).hostname.split('.')[0], new URL(url).hostname.startsWith('alpha') ? 3 : 2);
  const sites = [site('alpha', 'feed', 'https://alpha.example/feed'), site('beta', 'feed', 'https://beta.example/feed')];
  await f.run({ request, sites, run: f.store.startRun() });
  const view = options => resultsView(f.store, 'test', { threshold: 0.75, ...options });
  let page = view();
  assert.equal(page.total, 5);
  assert.deepEqual(page.facets.map(site => [site.id, site.count]), [['alpha', 3], ['beta', 2]]);
  assert.deepEqual(page.items[0].sites.map(site => site.id).length, 1);
  page = view({ sites: ['beta'] });
  assert.deepEqual([page.total, page.facets.length], [2, 2]); // Counts stay visible for every chip.
  assert.ok(page.items.every(row => row.sites[0].id === 'beta'));
  f.store.markSeen(['https://alpha.example/0']);
  page = view({ onlyNew: true, sites: ['alpha'] });
  assert.deepEqual([page.total, page.newCount, page.facets.find(site => site.id === 'alpha').count], [2, 4, 2]);
  assert.equal(view({ sort: 'new' }).items.at(-1).url, 'https://alpha.example/0'); // Seen results sort last.
  assert.equal(view({ sort: 'bogus' }).sort, 'new');
  const items = itemsView(f.store, 'test', { threshold: 0.75, sites: ['alpha'] });
  assert.deepEqual([items.total, items.all, items.facets.map(site => site.count)], [3, 5, [3, 2]]);
  assert.ok(items.items.every(item => item.sites.some(site => site.id === 'alpha')));
});

test('renaming a topic keeps its subtopics and fields, re-ranks it, and never collides with a later topic', async t => {
  const f = await fixture(t);
  const { renameTopic } = await import('../src/app/topics.mjs');
  const { addSubtopic, subtopicsOf } = await import('../src/app/subtopics.mjs');
  saveTopic(f.store, 'movies', false, { tags: ['film'] });
  addSubtopic(f.store, 'movies', 'space opera');
  const before = activeTopics(f.store)[0];
  const watchBefore = f.store.project(before.project).watch_hash;
  assert.equal(renameTopic(f.store, 'movies', 'science fiction films').status, 'renamed');
  const after = activeTopics(f.store)[0];
  assert.deepEqual([after.project, after.label, after.topic_key, after.tags], [before.project, 'science fiction films', 'science fiction films', ['film']]);
  assert.notEqual(f.store.project(after.project).watch_hash, watchBefore); // The new intent invalidates earlier scores.
  assert.equal(subtopicsOf(f.store, after.project).length, 1);
  assert.equal(renameTopic(f.store, 'science fiction films', 'science fiction films').status, 'unchanged');
  saveTopic(f.store, 'documentaries');
  assert.throws(() => renameTopic(f.store, 'science fiction films', 'Documentaries'), { code: 'TOPIC_EXISTS' });
  // The old text is free again and must not reuse the renamed topic's internal id.
  assert.equal(saveTopic(f.store, 'movies').status, 'added');
  const projects = activeTopics(f.store).map(topic => topic.project);
  assert.equal(new Set(projects).size, 3);
  assert.equal(f.store.project(after.project).query, 'science fiction films');
});
