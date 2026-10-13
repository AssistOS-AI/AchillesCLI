import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { initialize, defaults } from '../src/app/config.mjs';
import { openStore } from '../src/app/store.mjs';
import { saveTopic } from '../src/app/topics.mjs';
import { loadSiteCatalog, syncCatalog } from '../src/app/sites.mjs';
import { runCycle, intervalChoices } from '../src/app/monitor.mjs';
import { controlKeys, dueAt, monitorStatus, startMonitoring, stopMonitoring } from '../src/app/control.mjs';
import { runCycleTask } from '../src/agent/cycle.mjs';
import { Daemon } from '../src/agent/daemon.mjs';
import { runOperation } from '../tools/scout.mjs';

const quiet = () => {};
const profile = { provider: 'fake', model: 'test/model', revision: 'a'.repeat(40), dtype: 'q8', dimensions: 2,
  pooling: 'mean', maxTokens: 32, queryPrefix: '', documentPrefix: '' };
const registry = { fake: { version: 'fake-v1', create: async () => ({
  embed: async (texts, kind) => texts.map(text => kind === 'query' || /tomato/i.test(text) ? [1, 0] : [0, 1]),
  dispose: async () => {},
}) } };

async function fixtureServices(t) {
  const counts = { feed: 0 };
  const app = createServer((req, res) => {
    if (req.url === '/healthz') return res.end('ok');
    if (req.url === '/page') return res.end('<html><title>No feed here</title></html>');
    counts.feed++;
    res.end('<rss version="2.0"><channel><item><guid>a</guid><title>Tomatoes on a balcony</title>'
      + '<link>https://example.org/tomato</link></item><item><guid>b</guid><title>Football</title>'
      + '<link>https://example.org/football</link></item></channel></rss>');
  });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  t.after(() => new Promise(resolve => { app.close(resolve); app.closeAllConnections(); }));
  return { base, counts };
}

// A data directory as the install step leaves it, with RSSHub pointing at the local fixture.
async function agentData(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'scout-agent-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  await initialize(dataDir);
  const services = await fixtureServices(t);
  const config = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8'));
  await writeFile(join(dataDir, 'config.json'), JSON.stringify({ ...config, rsshubUrl: services.base }));
  // The daemon synchronizes the built-in site catalog when the agent starts.
  const store = await openStore(dataDir);
  syncCatalog(store, await loadSiteCatalog());
  store.close();
  const options = { dataDir, profile, registry };
  const tool = (name, input = {}) => runOperation(name, input, options);
  return { dataDir, services, options, tool };
}

async function withStore(t) {
  const dir = await mkdtemp(join(tmpdir(), 'scout-monitor-'));
  const store = await openStore(dir);
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  return store;
}

test('MCP operations manage topics and sites, start a cycle on demand and expose collected and ranked data', async t => {
  const s = await agentData(t);
  let status = await s.tool('status');
  assert.equal(status.monitoring, false);
  assert.equal(status.services.rsshub.healthy, true);
  assert.equal(s.services.counts.feed, 0); // Reading the status never collects.

  assert.equal((await s.tool('topic-create', { label: ' Tomato  growing ', searchTerms: ['tomatoes'], tags: ['gardening'] })).status, 'added');
  assert.equal((await s.tool('topic-create', { label: 'tomato growing' })).status, 'already exists');
  let [topic] = (await s.tool('topics-list')).items;
  assert.deepEqual([topic.label, topic.search_terms, topic.tags], ['Tomato growing', ['tomatoes'], ['gardening']]);
  assert.equal((await s.tool('topic-update', { key: topic.key, searchTerms: ['balcony tomatoes'], tags: [] })).status, 'updated');
  [topic] = (await s.tool('topics-list')).items;
  assert.deepEqual(topic.effective.tags, ['tomato growing', 'tomato', 'growing']); // Empty tags are derived.
  assert.deepEqual((await s.tool('topic-derive', { label: 'AI gaming news' })).searchTerms, ['ai gaming']);

  // Keep the test offline: disable the built-in catalog and use a site served by the fixture.
  const builtin = (await s.tool('sites-list')).items;
  assert.ok(builtin.length >= 10 && builtin.every(site => site.builtin));
  for (const site of builtin) await s.tool('site-set-enabled', { id: site.id, enabled: false });
  assert.equal((await s.tool('site-delete', { id: builtin[0].id })).error.code, 'SITE_BUILTIN');
  assert.equal((await s.tool('site-add', { name: 'Page', kind: 'feed', template: `${s.services.base}/page` })).error.code, 'FEED_NOT_FOUND');
  const added = await s.tool('site-add', { name: 'Garden search', kind: 'search', template: `${s.services.base}/search.rss?q={query}` });
  assert.equal((await s.tool('sites-list')).items.find(site => site.id === added.id).enabled, true);

  for (const hours of [0, 3, 25, 336]) assert.equal((await s.tool('monitor-start', { intervalHours: hours })).error.code, 'INPUT_INVALID');
  assert.deepEqual(status.intervalChoices, intervalChoices);
  status = await s.tool('monitor-start', { intervalHours: 4 });
  assert.deepEqual([status.monitoring, status.intervalHours, status.cycleRunning], [true, 4, false]);
  assert.equal((await s.tool('monitor-start', { intervalHours: 4 })).error.code, 'MONITOR_RUNNING');

  // The daemon would now start scout_run_cycle; run that cycle directly.
  const result = await runCycleTask({ ...s.options, report: quiet });
  assert.equal(result.status, 'ok');
  const [run] = (await s.tool('runs-list')).items;
  assert.deepEqual([run.stats.sources, run.stats.newItems, run.stats.passed, run.stats.newResults], [1, 2, 1, 1]);

  const items = await s.tool('items-list', { topic: topic.project });
  assert.equal(items.total, 2);
  assert.deepEqual(items.items.map(row => row.status).sort(), ['below threshold', 'passed']);
  assert.equal((await s.tool('items-list', { sites: ['missing-site'] })).total, 0);
  const [source] = (await s.tool('sources-list')).items;
  assert.deepEqual([source.items, source.site], [2, 'Garden search']);
  let results = (await s.tool('results-list', { new: true })).items;
  assert.deepEqual(results.map(row => [row.url, row.new, row.run]), [['https://example.org/tomato', true, run.id]]);
  assert.equal((await s.tool('results-mark-seen')).marked, 1);
  assert.equal((await s.tool('results-list')).items[0].new, false);
  assert.equal((await s.tool('discussions-mark-seen')).marked, 0);
  assert.equal((await s.tool('discussions-mark-seen', { matches: [{ item: 'x' }] })).error.code, 'INPUT_INVALID');

  status = await s.tool('monitor-stop');
  assert.deepEqual([status.monitoring, status.nextRunAt], [false, null]);
  const edited = await s.tool('topic-update', { key: topic.key, subtopics: [{ text: 'watering' }, { text: 'pots' }] });
  assert.deepEqual(edited.subtopics.map(row => row.text), ['watering', 'pots']);
  await s.tool('topic-update', { key: topic.key, subtopics: [] });
  await s.tool('topic-create', { label: 'Herbs' });
  assert.equal((await s.tool('topic-update', { key: topic.key, label: 'herbs' })).error.code, 'TOPIC_EXISTS');
  const subtopic = await s.tool('subtopic-add', { topic: topic.key, text: 'balcony tomatoes' });
  assert.equal(subtopic.status, 'added');
  const discussions = await s.tool('discussions-list', { show: 'all' });
  assert.deepEqual([discussions.all, discussions.pending], [0, 1]); // Read at the next run.
  assert.equal((await s.tool('subtopic-remove', { id: subtopic.id })).status, 'removed');
  assert.equal((await s.tool('subtopic-remove', { id: 999 })).error.code, 'SUBTOPIC_UNKNOWN');
  assert.equal((await s.tool('topic-delete', { key: topic.key })).status, 'removed');
  assert.equal((await s.tool('unknown')).error.code, 'USAGE');
  assert.equal((await s.tool('topic-create', { label: ' ' })).error.code, 'INPUT_INVALID');
});

test('the tool entry reads the AgentServer payload from stdin and prints one JSON value', async t => {
  const s = await agentData(t);
  const child = spawn(process.execPath, [new URL('../tools/scout.mjs', import.meta.url).pathname, 'topic-create'],
    { env: { ...process.env, SCOUT_DATA_DIR: s.dataDir }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', chunk => out += chunk);
  child.stdin.end(JSON.stringify({ tool: 'scout_topic_create', input: { label: 'Balcony gardening' }, metadata: {} }) + '\n');
  assert.equal(await new Promise(resolve => child.once('exit', resolve)), 0);
  assert.equal(JSON.parse(out).status, 'added');
});

test('monitoring control is persisted: Start makes a cycle due now, the interval follows the last start', async t => {
  const store = await withStore(t);
  store.saveSetting('intervalHours', 3); // Saved by an earlier version that offered every hour from 1 to 24.
  assert.equal(monitorStatus(store).intervalHours, 1);
  assert.throws(() => startMonitoring(store, 3), { code: 'INPUT_INVALID' });
  assert.equal(dueAt(store), null);
  startMonitoring(store, 168);
  assert.equal(dueAt(store), 0);
  const started = '2026-01-05T10:00:00.000Z';
  store.saveSetting(controlKeys.lastStartedAt, started);
  assert.equal(dueAt(store) - Date.parse(started), 168 * 3600000);
  store.saveSetting(controlKeys.taskId, 'task-1');
  assert.equal(monitorStatus(store).cycleRunning, true);
  assert.equal(monitorStatus(store).nextRunAt, null);
  stopMonitoring(store);
  assert.throws(() => startMonitoring(store, 1), { code: 'MONITOR_STOPPING' });
});

test('the daemon starts each due cycle as a task, follows it and cancels it only if Stop is ignored', async t => {
  const store = await withStore(t);
  saveTopic(store, 'gardening');
  let clock = Date.parse('2026-01-05T10:00:00.000Z'), statuses = [], cancelled = [], started = 0, fail = null;
  const client = {
    callToolWithoutWait: async tool => { if (fail) throw fail; started++; assert.equal(tool, 'scout_run_cycle'); return { metadata: { taskId: `task-${started}` } }; },
    getTaskStatus: async () => statuses.shift(),
    cancelTask: async id => { cancelled.push(id); },
  };
  const services = [];
  const daemon = new Daemon({ store, settings: defaults, dataDir: '/unused', client, report: quiet, now: () => clock,
    startService: async name => { services.push(name); } });
  await daemon.tick();
  assert.deepEqual([started, services], [0, ['rsshub']]); // Monitoring is off.
  startMonitoring(store, 2);
  await daemon.tick();
  assert.equal(started, 1);
  assert.equal(store.setting(controlKeys.taskId), 'task-1');
  assert.equal(store.setting(controlKeys.daemon).services.rsshub.state, 'running');
  statuses.push({ status: 'running' });
  await daemon.tick();
  assert.equal(started, 1);
  // A task killed with the agent leaves its run open; following the task closes it.
  store.startRun();
  statuses.push({ status: 'failed' });
  await daemon.tick();
  assert.deepEqual([store.setting(controlKeys.taskId), store.setting(controlKeys.lastTaskId)], [null, 'task-1']);
  assert.equal(store.db.prepare('SELECT status FROM runs').get().status, 'interrupted');
  clock += 3600000;
  await daemon.tick();
  assert.equal(started, 1); // Not due for two hours after the last start.
  clock += 3600000;
  await daemon.tick();
  assert.equal(started, 2);
  stopMonitoring(store);
  statuses.push({ status: 'running' }, { status: 'running' });
  await daemon.tick();
  assert.deepEqual(cancelled, []);
  clock += 60000;
  await daemon.tick();
  assert.deepEqual(cancelled, ['task-2']);
  statuses.push(Promise.reject(new Error('agent task status failed (status 404): task not found')));
  await daemon.tick();
  assert.equal(store.setting(controlKeys.taskId), null);
  // A router that is not ready yet delays the next attempt instead of retrying on every tick.
  startMonitoring(store, 1);
  fail = new Error('router unavailable');
  await daemon.tick();
  fail = null;
  await daemon.tick();
  assert.equal(started, 2);
  clock += 30000;
  await daemon.tick();
  assert.equal(started, 3);
});

test('Stop aborts a running cycle task, which keeps its run record', async t => {
  const s = await agentData(t);
  const store = await openStore(s.dataDir);
  t.after(() => store.close());
  saveTopic(store, 'gardening');
  startMonitoring(store, 2);
  let searching;
  const searched = new Promise(resolve => { searching = resolve; });
  const running = runCycleTask({ ...s.options, report: quiet, pollMs: 20,
    search: (_store, _service, _settings, { signal }) => new Promise((_resolve, reject) => {
      searching();
      signal.addEventListener('abort', () => reject(signal.reason));
    }) });
  await searched;
  stopMonitoring(store);
  assert.equal((await running).status, 'aborted');
  assert.equal(store.db.prepare('SELECT status FROM runs').get().status, 'aborted');
});

test('a cycle aborted by its signal records the run; topics too long for the model are skipped', async t => {
  const store = await withStore(t);
  saveTopic(store, 'short'); saveTopic(store, 'very long topic');
  let searched;
  const result = await runCycle({ store, settings: defaults, ensureServices: async () => {},
    createService: async () => ({ dispose: async () => {}, embed: async ([text]) => {
      if (text.length > 6) throw Object.assign(Error('too many tokens'), { code: 'TEXT_TOO_LONG' });
      return [[1, 0]];
    } }),
    search: async (_store, _service, _settings, { topics }) => {
      searched = topics.map(topic => topic.label);
      return { rows: [], errors: [], stats: {} };
    } });
  assert.deepEqual(searched, ['short']);
  assert.equal(result.status, 'partial');
  assert.match(store.db.prepare('SELECT errors FROM runs').get().errors, /very long topic/);
  const controller = new AbortController();
  let disposed = 0;
  const aborted = runCycle({ store, settings: defaults, signal: controller.signal, ensureServices: async () => {},
    createService: async () => ({ embed: async () => [[1, 0]], dispose: async () => { disposed++; } }),
    search: (_store, _service, _settings, { signal }) => new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason))) });
  await delay(10);
  controller.abort(Object.assign(Error('Monitoring was stopped'), { code: 'ABORTED' }));
  assert.equal((await aborted).status, 'aborted');
  assert.equal(disposed, 1);
});

test('every declared tool has an operation, and the web interface calls only declared, user-callable tools', async () => {
  const { operations } = await import('../src/agent/operations.mjs');
  const config = JSON.parse(await readFile(new URL('../mcp-config.json', import.meta.url), 'utf8'));
  const declared = new Map(config.tools.map(tool => [tool.name, tool]));
  for (const tool of config.tools.filter(tool => tool.args[0] === 'tools/scout.mjs')) {
    assert.ok(operations[tool.args[1]], tool.name);
    assert.equal(tool.tags, undefined, `${tool.name} must stay callable by authenticated users`);
  }
  assert.deepEqual(declared.get('scout_run_cycle').tags, ['internal']);
  assert.equal(declared.get('scout_run_cycle').async, true);
  const page = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  const called = [...page.matchAll(/call\('(scout_[a-z_]+)'/g)].map(match => match[1]);
  assert.ok(called.length > 15);
  for (const name of called) assert.ok(declared.has(name) && !declared.get(name).tags, name);
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(page + html, /\/api\/|EventSource|data-tab="ala"|Generate comment/);
});
