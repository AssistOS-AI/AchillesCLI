import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { openStore } from '../src/app/store.mjs';
import { defaults } from '../src/app/config.mjs';
import { createHttp } from '../src/providers/http.mjs';
import { parseFeed, pollFeed, resolveFeed } from '../src/providers/feeds.mjs';
import { plain } from '../src/app/normalize.mjs';
import { evaluateProject } from '../src/app/workflows.mjs';
import { saveTopic } from '../src/app/topics.mjs';
import { resultsView, itemsView, runsView, topicsView, pageSizes } from '../src/app/views.mjs';

async function database(t) {
  const dir = await mkdtemp(join(tmpdir(), 'scout-app-'));
  const store = await openStore(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  store.saveProject('garden', 'gardening');
  return store;
}
async function server(t, handler) {
  const app = createServer(handler);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }));
  return `http://127.0.0.1:${app.address().port}/`;
}
const item = (id, text = 'gardening') => ({ url: `https://example.org/${id}`, title: text,
  text, platform: 'example', external_id: id, thread_id: id });
const model = { space: 'test-v1', embed: async texts => texts.map(text => text.includes('gardening') ? [1, 0] : [0, 1]) };

test('RSS ingestion is idempotent, conditional and shared across projects; invalid polls are atomic', async t => {
  const store = await database(t);
  let bad = false, conditional = 0;
  const url = await server(t, (req, res) => {
    if (bad) { res.end('<rss><channel><item><title>broken</title></item></channel></rss>'); return; }
    if (req.headers['if-none-match'] === 'v1') { conditional++; res.writeHead(304); res.end(); return; }
    res.setHeader('ETag', 'v1');
    res.end('<rss version="2.0"><channel><item><guid>a</guid><title>gardening</title>'
      + '<link>https://example.org/a?utm_source=x</link><description><![CDATA[<b>Growing</b>]]></description>'
      + '</item></channel></rss>');
  });
  const request = createHttp(defaults);
  const source = store.addSource('garden', 'rss', url);
  const poll = async () => {
    const [row] = store.sources('garden');
    const result = await pollFeed(url, JSON.parse(row.state), request);
    return store.ingest(row, result.items, result.state, { feed: true });
  };
  assert.equal(await poll(), 1);
  const first = store.available('garden', '0000', true)[0];
  assert.equal(first.text, 'Growing'); assert.equal(first.url, 'https://example.org/a');
  assert.equal(await poll(), 0);
  assert.equal(conditional, 1);
  store.saveProject('book', 'book'); store.addSource('book', 'rss', url);
  assert.equal(store.available('book', '0000', true).length, 1);
  bad = true;
  await assert.rejects(poll(), { code: 'FEED_INVALID' });
  assert.equal(JSON.parse(store.sources('garden')[0].state).etag, 'v1');
  assert.equal(store.available('garden', '0000')[0].fetched_at, first.fetched_at);
  assert.equal(source.id, store.sources('book')[0].id);
});

test('Atom, RSS 1.0 and media feeds parse; numeric entities decode; unsafe XML is rejected', async () => {
  const rows = await parseFeed('<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>urn:1</id>'
    + '<title>A &amp; B</title><link href="/one"/><content>hello</content>'
    + '<author><name>Ana</name></author></entry></feed>', 'https://example.org/feed');
  assert.equal(rows[0].url, 'https://example.org/one'); assert.equal(rows[0].author, 'Ana');
  assert.equal(rows[0].title, 'A & B');
  const rdf = await parseFeed('<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/"'
    + ' xmlns:dc="http://purl.org/dc/elements/1.1/"><channel rdf:about="https://slashdot.org/"><title>S</title></channel>'
    + '<item rdf:about="https://slashdot.org/story/1"><title>Story</title><link>https://slashdot.org/story/1</link>'
    + '<description>Body</description><dc:date>2026-10-09T10:00:00+00:00</dc:date></item></rdf:RDF>', 'https://slashdot.org');
  assert.deepEqual([rdf[0].url, rdf[0].text, rdf[0].date], ['https://slashdot.org/story/1', 'Body', '2026-10-09T10:00:00+00:00']);
  const media = await parseFeed('<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">'
    + '<entry><id>yt:1</id><title>Video</title><link rel="alternate" href="https://www.youtube.com/watch?v=1"/>'
    + '<media:group><media:description>Planting tomatoes</media:description></media:group></entry></feed>', 'https://www.youtube.com');
  assert.equal(media[0].text, 'Planting tomatoes');
  const mastodon = await parseFeed('<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><item>'
    + '<link>https://m.social/@a/1</link><description>Post body</description>'
    + '<media:content url="https://m.social/a.png" type="image/png"/></item></channel></rss>', 'https://m.social');
  assert.equal(mastodon[0].text, 'Post body');
  assert.equal(plain('Can&#x27;t &#39;stop&#39; &amp; go'), "Can't 'stop' & go");
  await assert.rejects(parseFeed('<!DOCTYPE foo><feed/>', 'https://example.org'), { code: 'FEED_INVALID' });
});

test('HTTP retries server errors, never retries 429 and names redirect targets', async t => {
  let calls = 0;
  const base = await server(t, (_req, res) => { calls++; res.writeHead(calls < 3 ? 503 : 200); res.end('{}'); });
  assert.deepEqual((await createHttp(defaults)(base)).body, {}); assert.equal(calls, 3);
  let limitedCalls = 0;
  const limited = createHttp(defaults, async () => { limitedCalls++; return new Response('', { status: 429 }); });
  await assert.rejects(limited('https://example.org?key=secret'), error => error.code === 'RATE_LIMITED'
    && error.status === 429 && !error.message.includes('secret'));
  assert.equal(limitedCalls, 1);
  const moved = createHttp(defaults, async () => new Response(null, { status: 301, headers: { Location: 'https://www.example.org/feed' } }));
  await assert.rejects(moved('https://example.org/feed'), error => error.code === 'REDIRECTED'
    && error.message.includes('https://www.example.org/feed'));
});

test('a web page resolves to its same-origin advertised feed; pages without one are refused', async t => {
  let base;
  const url = await server(t, (req, res) => {
    if (req.url === '/page') return res.end(`<html><link rel="alternate" type="application/rss+xml" href="/feed">
      <link rel="alternate" type="application/atom+xml" href="https://other.example/feed"></html>`);
    if (req.url === '/plain') return res.end('<html><title>No feed</title></html>');
    res.end('<rss version="2.0"><channel><item><title>x</title><link>https://example.org/x</link></item></channel></rss>');
  });
  base = url.slice(0, -1);
  const request = createHttp(defaults);
  assert.equal(await resolveFeed(`${base}/page`, request), `${base}/feed`);
  assert.equal(await resolveFeed(`${base}/feed`, request), `${base}/feed`);
  await assert.rejects(resolveFeed(`${base}/plain`, request), { code: 'FEED_NOT_FOUND' });
});

test('views separate collected entries from passing results and keep new marks until seen', async t => {
  const store = await database(t);
  saveTopic(store, 'gardening');
  const project = store.db.prepare('SELECT project FROM topics').get().project;
  const source = store.addSource(project, 'rss', 'https://example.org/feed');
  store.ingest(source, [item('1'), item('2', 'football')], {}, { feed: true });
  const manual = store.addSource(project, 'manual', 'test');
  store.ingest(manual, [item('3')], {}); // Without feed provenance it is never shown or ranked.
  const { evaluations, watch } = await evaluateProject(store, model, project, 7, { feedOnly: true });
  store.saveEvaluations(project, model.space, evaluations, watch.watch_hash);
  const run = store.startRun();
  assert.equal(store.saveFindings(run, evaluations.filter(row => row.score >= 0.75)), 1);
  store.finishRun(run, 'ok');
  const collected = itemsView(store, model.space, { threshold: 0.75 });
  assert.equal(collected.total, 2);
  assert.deepEqual(collected.items.map(row => row.status).sort(), ['below threshold', 'passed']);
  let results = resultsView(store, model.space, { threshold: 0.75 }).items;
  assert.deepEqual(results.map(row => [row.url, row.new, row.run]), [['https://example.org/1', true, run]]);
  assert.equal(store.markSeen(['https://example.org/1']), 1);
  results = resultsView(store, model.space, { threshold: 0.75 }).items;
  assert.equal(results[0].new, false);
  assert.equal(resultsView(store, 'other-model', { threshold: 0.75 }).total, 0); // Scores are isolated by model namespace.
  store.saveProject(project, 'different intent');
  assert.equal(resultsView(store, model.space, { threshold: 0.75 }).total, 0); // Changed intent invalidates old scores.
  await assert.rejects(async () => store.saveEvaluations(project, model.space, evaluations, watch.watch_hash), { code: 'WATCH_CHANGED' });
});

test('long Retry-After dates on server errors do not trigger immediate retries', async () => {
  let calls = 0;
  const request = createHttp(defaults, async () => {
    calls++; return new Response('', { status: 503, headers: { 'Retry-After': new Date(Date.now() + 60000).toUTCString() } });
  });
  await assert.rejects(request('https://example.org'), { code: 'PROVIDER_UNAVAILABLE' }); assert.equal(calls, 1);
});

test('every list is paged with its default size and stays within bounds', async t => {
  const store = await database(t);
  for (let i = 0; i < 30; i++) store.finishRun(store.startRun(), 'ok');
  let runs = runsView(store);
  assert.deepEqual([runs.total, runs.offset, runs.limit, runs.items.length, runs.items[0].id], [30, 0, pageSizes.runs, 24, 30]);
  runs = runsView(store, { offset: '24', limit: '10' });
  assert.deepEqual([runs.offset, runs.items.length, runs.items.at(-1).id], [24, 6, 1]);
  assert.equal(runsView(store, { limit: '100000' }).limit, 500);
  assert.equal(runsView(store, { offset: '-5', limit: 'x' }).offset, 0);
  for (let i = 0; i < 23; i++) saveTopic(store, `topic number ${i}`);
  const topics = topicsView(store, { offset: '20' });
  assert.deepEqual([topics.total, topics.limit, topics.items.length], [23, 20, 3]);
  assert.deepEqual(pageSizes, { topics: 20, sites: 20, results: 25, discussions: 25, items: 50, sources: 50, runs: 24 });
});
