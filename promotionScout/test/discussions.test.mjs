import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/app/store.mjs';
import { saveTopic, activeTopics } from '../src/app/topics.mjs';
import { addSubtopic, removeSubtopic, subtopicsOf, replaceSubtopics } from '../src/app/subtopics.mjs';
import { searchTopics } from '../src/app/search.mjs';
import { discussionsView, topicsView } from '../src/app/views.mjs';
import { fetchThread, pageText } from '../src/providers/threads.mjs';
import { defaults } from '../src/app/config.mjs';

async function database(t) {
  const dir = await mkdtemp(join(tmpdir(), 'scout-discussions-'));
  const store = await openStore(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  return store;
}
const fail = (status) => Object.assign(new Error(`HTTP ${status}`), { code: 'HTTP_ERROR', status });

test('subtopics belong to one topic, ignore duplicates and are listed with their topic', async t => {
  const store = await database(t);
  saveTopic(store, 'AI gaming news');
  const first = addSubtopic(store, 'ai gaming news', ' AI   NPC dialogue ');
  assert.deepEqual([first.status, first.text], ['added', 'AI NPC dialogue']);
  assert.equal(addSubtopic(store, 'AI gaming news', 'ai npc dialogue').status, 'already exists');
  addSubtopic(store, 'AI gaming news', 'Procedural level generation');
  assert.throws(() => addSubtopic(store, 'unknown topic', 'x'), { code: 'TOPIC_UNKNOWN' });
  assert.throws(() => addSubtopic(store, 'AI gaming news', ' '), { code: 'INPUT_INVALID' });
  const [topic] = topicsView(store).items;
  assert.deepEqual(topic.subtopics.map(subtopic => subtopic.text), ['AI NPC dialogue', 'Procedural level generation']);
  removeSubtopic(store, first.id);
  assert.equal(subtopicsOf(store, topic.project).length, 1);
  assert.throws(() => removeSubtopic(store, 999), { code: 'SUBTOPIC_UNKNOWN' });
});

test('editing replaces the subtopic list, keeping unchanged ids and their scores', async t => {
  const store = await database(t);
  saveTopic(store, 'AI gaming news');
  const project = activeTopics(store)[0].project;
  const keep = addSubtopic(store, 'AI gaming news', 'NPC dialogue').id;
  const change = addSubtopic(store, 'AI gaming news', 'GPU prices').id;
  const drop = addSubtopic(store, 'AI gaming news', 'Level design').id;
  const after = store.transaction(() => replaceSubtopics(store, project, [
    { id: keep, text: 'NPC  dialogue' }, { id: change, text: 'Graphics card prices' }, { text: 'Modding tools' },
    { text: 'modding tools' }, { text: '  ' },
  ]));
  assert.deepEqual(after.map(row => row.text), ['NPC dialogue', 'Graphics card prices', 'Modding tools']);
  assert.equal(after[0].id, keep);
  assert.ok(!after.some(row => row.id === change || row.id === drop));
  assert.throws(() => replaceSubtopics(store, project, [{ text: 'x'.repeat(501) }]), { code: 'INPUT_INVALID' });
});

test('a discussion matching two topics is scored only under its best topic, against that topic\'s subtopics', async t => {
  const store = await database(t);
  saveTopic(store, 'AI gaming news');
  saveTopic(store, 'AI hardware news');
  const [gaming, hardware] = ['AI gaming news', 'AI hardware news']
    .map(label => activeTopics(store).find(topic => topic.label === label));
  addSubtopic(store, gaming.topic_key, 'npc dialogue');
  addSubtopic(store, hardware.topic_key, 'graphics cards');
  const feed = '<rss version="2.0"><channel><item><guid>https://forum.example/t/x/1</guid>'
    + '<title>AI hardware news</title><link>https://article.example/x</link></item></channel></rss>';
  const request = async url => new URL(url).hostname === 'feeds.example' ? { body: feed }
    : new URL(url).pathname.endsWith('.json') ? Promise.reject(fail(404))
      : { type: 'text/html', body: '<html><body><article>AI hardware: npc dialogue and graphics cards</article></body></html>' };
  // Normalized toy vectors: both topics pass (gaming 0.71, hardware 1); hardware is the best topic, so only its subtopic
  // is compared with the discussion.
  const words = ['npc', 'graphics', 'hardware'];
  const service = { space: 'toy', threshold: 0.5, async embed(texts) {
    return texts.map(text => {
      const vector = [...words.map(word => Number(text.toLowerCase().includes(word))), 1];
      return vector.map(value => value / Math.hypot(...vector));
    });
  } };
  const run = await searchTopics(store, service, defaults, { request, wait: async () => {}, run: store.startRun(), now: Date.now(),
    sites: [{ id: 'feed', name: 'Feed', kind: 'feed', template: 'https://feeds.example/rss', options: {} }] });
  assert.equal(run.stats.threadsScored, 1);
  const view = discussionsView(store, 'toy', { threshold: 0.5 });
  assert.deepEqual(view.items.map(row => [row.topic, row.winner?.text, row.scores.map(score => score.text)]),
    [['AI hardware news', 'graphics cards', ['graphics cards']]]);
  assert.equal(discussionsView(store, 'toy', { threshold: 0.5, project: gaming.project }).total, 0);
  // Subtopics have their own threshold: a stricter one leaves the discussion without a winner.
  assert.equal(discussionsView(store, 'toy', { threshold: 0.5, subtopicThreshold: 0.8 }).matched, 0);
  store.markSubtopicMatchesSeen([{ item: view.items[0].id, topic: view.items[0].project }]);
  assert.equal(discussionsView(store, 'toy', { threshold: 0.5 }).newCount, 0);
});

test('a run reads every due discussion in batches, alternating topics and deferring paused hosts', async t => {
  const store = await database(t);
  for (const label of ['alpha', 'beta']) {
    saveTopic(store, label);
    addSubtopic(store, label, `${label} discussion`);
  }
  const items = [
    ...Array.from({ length: 33 }, (_, n) => ['a.example', `alpha post ${n}`]),
    ['b.example', 'beta post 1'], ['b.example', 'beta post 2'], ['paused.example', 'beta post 3'],
  ];
  const feed = '<rss version="2.0"><channel>' + items.map(([host, title], n) =>
    `<item><guid>https://${host}/p/${n}</guid><title>${title}</title><link>https://${host}/p/${n}</link></item>`).join('')
    + '</channel></rss>';
  const hosts = [];
  const request = async url => {
    const address = new URL(url);
    if (address.hostname === 'feeds.example') return { body: feed };
    hosts.push(address.hostname);
    const word = address.hostname === 'a.example' ? 'alpha' : 'beta';
    return { type: 'text/html', body: `<html><body><article>${word} discussion</article></body></html>` };
  };
  const service = { space: 'toy', threshold: 0.5, async embed(texts) {
    return texts.map(text => {
      const vector = [Number(text.includes('alpha')), Number(text.includes('beta')), 0.1];
      return vector.map(value => value / Math.hypot(...vector));
    });
  } };
  store.saveSetting('backoff:paused.example', Date.now() + 3600000);
  const logs = [];
  const run = await searchTopics(store, service, defaults, { request, wait: async () => {}, run: store.startRun(),
    now: Date.now(), report: message => logs.push(message),
    sites: [{ id: 'feed', name: 'Feed', kind: 'feed', template: 'https://feeds.example/rss', options: {} }] });
  assert.deepEqual([run.stats.threadsRead, run.stats.threadsDeferred, run.stats.subtopicMatches], [35, 1, 35]);
  assert.equal(logs.filter(message => message.startsWith('Discussions batch ')).length, 2);
  assert.deepEqual(hosts.slice(0, 4).map(host => host[0]), ['a', 'b', 'a', 'b']); // Topics take turns.
  assert.ok(!hosts.includes('paused.example'));
  // The deferred discussion used no attempt, so it is read as soon as its host is no longer paused.
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM threads WHERE url LIKE 'https://paused.example/%'").get().n, 0);
});

test('discussion adapters read structured sources and fall back to page text', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push(String(url));
    const address = new URL(url);
    if (address.hostname === 'hn.algolia.com') return { body: { title: 'Show HN: a game', text: '<p>We built it</p>',
      children: [{ text: 'Great &amp; fun' }, { text: '' }, { text: 'How does the AI work?' }] } };
    if (address.hostname === 'www.reddit.com') return { body: [{ data: { children: [{ data: { title: 'Post', selftext: 'Body' } }] } },
      { data: { children: [{ kind: 't1', data: { body: 'First' } }, { kind: 'more', data: {} }] } }] };
    if (address.pathname.startsWith('/feeds/question/')) return { body: '<feed xmlns="http://www.w3.org/2005/Atom">'
      + '<entry><id>q</id><title>Question</title><link href="https://superuser.com/q/1"/><summary>Why?</summary></entry>'
      + '<entry><id>a</id><title>Answer</title><link href="https://superuser.com/a/2"/><summary>Because.</summary></entry></feed>' };
    if (address.pathname === '/api/v3/post') throw fail(404); // Not a Lemmy server despite the /post/ shape.
    return { type: 'text/html', body: '<html><head><title>Blog</title></head><body><nav>Menu</nav><article><h1>Long read</h1>'
      + `<p>${'Readable article text. '.repeat(20)}</p></article><footer>Footer</footer></body></html>` };
  };
  const hn = await fetchThread('https://news.ycombinator.com/item?id=42', request);
  assert.deepEqual([hn.source, hn.title, hn.post, hn.comments], ['hacker-news', 'Show HN: a game', 'We built it', ['Great & fun', 'How does the AI work?']]);
  const reddit = await fetchThread('https://www.reddit.com/r/games/comments/abc123/title/', request, { comments: 5 });
  assert.deepEqual([reddit.source, reddit.comments], ['reddit', ['First']]);
  assert.match(calls.at(-1), /comments\/abc123\.json\?depth=1&limit=5&sort=top/);
  const se = await fetchThread('https://superuser.com/questions/1/why', request);
  assert.deepEqual([se.title, se.post, se.comments], ['Question', 'Why?', ['Because.']]);
  const page = await fetchThread('https://blog.example/post/7', request);
  assert.equal(page.source, 'page');
  assert.ok(page.post.startsWith('Long read Readable article text.') && !page.post.includes('Menu') && !page.post.includes('Footer'));
  assert.deepEqual(pageText('<html><meta property="og:description" content="App summary"><body><div id="root"></div></body></html>').post, 'App summary');
  await assert.rejects(fetchThread('https://lemmy.example/post/9', async () => { throw fail(429); }), { status: 429 });
});

test('a run reads result discussions, scores them against subtopics and picks the best matching subtopic', async t => {
  const store = await database(t);
  saveTopic(store, 'AI gaming news');
  const key = activeTopics(store)[0].topic_key;
  addSubtopic(store, key, 'npc dialogue');
  addSubtopic(store, key, 'graphics cards');
  addSubtopic(store, key, 'level design');
  // Feed entries link to articles; their guid is the discussion page.
  const feed = '<rss version="2.0"><channel>'
    + '<item><guid>https://forum.example/t/npc/1</guid><title>Smarter gaming NPCs</title><link>https://article.example/npc</link></item>'
    + '<item><guid>https://forum.example/t/gpu/2</guid><title>GPU prices for gaming</title><link>https://article.example/gpu</link></item>'
    + '<item><guid>https://refusing.example/x</guid><title>Blocked gaming post</title><link>https://refusing.example/x</link></item></channel></rss>';
  const pages = {
    '/t/npc/1': 'Gaming NPC dialogue written by language models. Players liked the npc dialogue.',
    '/t/gpu/2': 'Gaming graphics cards are expensive. Which graphics cards are worth it?',
  };
  let refusals = 0;
  const request = async (url) => {
    const address = new URL(url);
    if (address.hostname === 'feeds.example') return { body: feed };
    if (address.hostname === 'refusing.example') { refusals++; throw fail(403); }
    if (address.pathname.endsWith('.json')) throw fail(404); // These /t/ pages are not Discourse.
    return { type: 'text/html', body: `<html><body><article>${pages[address.pathname]}</article></body></html>` };
  };
  // A toy model: each vector marks which words a text mentions; every result mentions gaming, the topic.
  const words = ['npc', 'graphics', 'level', 'gaming'];
  const service = { space: 'toy', threshold: 0.5, async embed(texts) {
    return texts.map(text => { const v = words.map(word => Number(text.toLowerCase().includes(word))); v.push(0.2); return v; });
  } };
  const sites = [{ id: 'feed', name: 'Feed', kind: 'feed', template: 'https://feeds.example/rss', options: {} }];
  const run = () => searchTopics(store, service, defaults, { request, sites, wait: async () => {}, run: store.startRun(), now: Date.now() });
  const first = await run();
  assert.deepEqual([first.stats.threadsRead, first.stats.threadsFailed, first.stats.subtopicMatches], [2, 1, 2]);
  const view = discussionsView(store, 'toy', { threshold: 0.5, show: 'all' });
  assert.deepEqual([view.all, view.matched, view.pending], [3, 2, 0]);
  const npc = view.items.find(row => row.thread_url.endsWith('/t/npc/1'));
  assert.equal(npc.winner.text, 'npc dialogue');
  assert.equal(npc.scores.length, 3);
  assert.equal(view.items.find(row => row.thread_url.endsWith('/t/gpu/2')).winner.text, 'graphics cards');
  assert.match(view.items.find(row => row.error).error, /HTTP 403/);
  assert.equal(discussionsView(store, 'toy', { threshold: 0.5 }).total, 2); // Matched only by default.
  // Matches are new until marked seen, and a match is new only once.
  assert.deepEqual([first.stats.newSubtopicMatches, view.newCount, npc.new], [2, 2, true]);
  assert.equal(store.markSubtopicMatchesSeen([{ item: npc.id, topic: npc.project }]), 1);
  assert.deepEqual(discussionsView(store, 'toy', { threshold: 0.5, show: 'new' }).items.map(row => row.thread_url),
    ['https://forum.example/t/gpu/2']);
  // Scores are cached; the refusing host stays paused instead of being asked again.
  const second = await run();
  assert.deepEqual([second.stats.threadsRead, second.stats.threadsScored, refusals], [0, 0, 1]);
  assert.deepEqual([second.stats.newSubtopicMatches, discussionsView(store, 'toy', { threshold: 0.5 }).newCount], [0, 1]);
  assert.equal(store.markSubtopicMatchesSeen(), 1);
  addSubtopic(store, key, 'level design ideas');
  const third = await run();
  assert.equal(third.stats.threadsScored, 2); // Only the new subtopic is scored.
  assert.equal(discussionsView(store, 'toy', { threshold: 0.5 }).newCount, 0); // Already matched before: not new again.
});
