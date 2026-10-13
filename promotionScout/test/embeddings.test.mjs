import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, access, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createEmbeddingService, normalize } from '../src/embeddings/index.mjs';
import { loadProfile } from '../src/embeddings/config.mjs';
import { checkRuntime } from '../src/runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = { provider: 'fake', model: 'test/model', revision: 'a'.repeat(40), dtype: 'q8', dimensions: 2, pooling: 'mean', maxTokens: 32, queryPrefix: 'query: ', documentPrefix: 'passage: ' };

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'scout-test-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

function registry(counter, version = 'v1', output) {
  return { fake: { version, async create() { return {
    async embed(texts, kind) {
      counter.calls += texts.length;
      return texts.map(text => output ?? (kind === 'query' || text === 'relevant' ? [3, 0] : [0, 2]));
    },
    async dispose() {},
  }; } } };
}

test('cache survives reopen and separates model revisions, prefixes and provider versions', async t => {
  const dataDir = await directory(t);
  const counter = { calls: 0 };
  let service = await createEmbeddingService(base, { dataDir, registry: registry(counter) });
  const originalSpace = service.space;
  assert.deepEqual(await service.embed(['relevant', 'relevant']), [[1, 0], [1, 0]]);
  assert.equal(counter.calls, 1);
  await service.dispose();
  service = await createEmbeddingService(base, { dataDir, registry: registry(counter) });
  await service.embed(['relevant']);
  assert.equal(counter.calls, 1);
  await service.embed(['relevant'], 'query');
  assert.equal(counter.calls, 2);
  await service.dispose();
  for (const patch of [{ revision: 'b'.repeat(40) }, { queryPrefix: 'search: ' }, { dimensions: 2, dtype: 'fp32' }]) {
    service = await createEmbeddingService({ ...base, ...patch }, { dataDir, registry: registry(counter) });
    assert.notEqual(service.space, originalSpace);
    await service.embed(['relevant']);
    await service.dispose();
  }
  service = await createEmbeddingService(base, { dataDir, registry: registry(counter, 'v2') });
  assert.notEqual(service.space, originalSpace);
  await service.embed(['relevant']);
  await service.dispose();
  assert.equal(counter.calls, 6);
});

test('ranking compares normalized vectors and preserves document metadata', async t => {
  const service = await createEmbeddingService(base, { dataDir: await directory(t), registry: registry({ calls: 0 }) });
  t.after(() => service.dispose());
  const results = await service.rank('question', [{ id: 'b', text: 'other' }, { id: 'a', text: 'relevant', url: 'https://example.com' }], 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'a');
  assert.equal(results[0].similarity, 1);
  assert.equal(results[0].url, 'https://example.com');
  await assert.rejects(service.rank('question', [{ title: 'no text' }]), { code: 'INPUT_INVALID' });
  await assert.rejects(service.rank('question', [], 0), { code: 'INPUT_INVALID' });
  assert.deepEqual(await service.rank('question', []), []);
});

test('bad inference output fails, never caches invented vectors', async t => {
  const dataDir = await directory(t);
  for (const output of [[0, 0], [NaN, 1], [1], [Infinity, 1]]) {
    const service = await createEmbeddingService(base, { dataDir, registry: registry({ calls: 0 }, 'v1', output) });
    await assert.rejects(service.embed(['test']), { code: 'EMBEDDING_INVALID' });
    await service.dispose();
  }
  const counter = { calls: 0 };
  const service = await createEmbeddingService(base, { dataDir, registry: registry(counter) });
  await service.embed(['test']);
  assert.equal(counter.calls, 1);
  await service.dispose();
});

test('missing provider/model leaves no SQLite database', async t => {
  const dataDir = join(await directory(t), 'absent');
  await assert.rejects(createEmbeddingService(base, { dataDir }), { code: 'PROVIDER_UNKNOWN' });
  const unavailable = { fake: { version: 'v1', async create() { throw new Error('unavailable'); } } };
  await assert.rejects(createEmbeddingService(base, { dataDir, registry: unavailable }), /unavailable/);
  await assert.rejects(access(dataDir));
});

test('profiles reject mutable revisions and resolve bundled config independently of cwd', async t => {
  const loaded = await loadProfile();
  assert.deepEqual([loaded.name, loaded.profile.dimensions, loaded.profile.maxTokens, loaded.threshold], ['embeddinggemma-300m', 768, 2048, 0.25]);
  assert.equal(loaded.subtopicThreshold, 0.35);
  assert.equal(loaded.profile.threshold, undefined); // The threshold never changes the vector namespace.
  assert.equal((await loadProfile({ model: 'multilingual-e5-small' })).profile.dimensions, 384);
  await assert.rejects(loadProfile({ model: 'unknown' }), { code: 'MODEL_UNKNOWN' });
  const path = join(await directory(t), 'models.json');
  await writeFile(path, JSON.stringify({ defaultModel: 'custom', models: { custom: { ...base, revision: 'main', threshold: 0.5 } } }));
  await assert.rejects(loadProfile({ config: path }), { code: 'CONFIG_INVALID' });
  await writeFile(path, JSON.stringify({ defaultModel: 'custom', models: { custom: base } }));
  await assert.rejects(loadProfile({ config: path }), { code: 'CONFIG_INVALID' }); // Missing threshold.
  assert.throws(() => checkRuntime('20.0.0'), { code: 'RUNTIME_UNSUPPORTED' });
  assert.throws(() => normalize([0, 0], 2), { code: 'EMBEDDING_INVALID' });
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {loadCatalog} from ${JSON.stringify(new URL('../src/embeddings/config.mjs', import.meta.url).href)}; console.log(JSON.stringify(await loadCatalog()));`], { cwd: tmpdir(), encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).defaultModel, 'embeddinggemma-300m');
});

test('a missing inference dependency gives an actionable error before creating data', async t => {
  const copied = await directory(t);
  for (const path of ['src', 'config']) await cp(join(root, path), join(copied, path), { recursive: true });
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {loadProfile} from './src/embeddings/config.mjs'; import {createEmbeddingService} from './src/embeddings/index.mjs'; await createEmbeddingService((await loadProfile()).profile,{dataDir:'.scout'});`], { cwd: copied, encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /DEPENDENCY_MISSING/);
  assert.match(child.stderr, /install step/);
  assert.equal(child.stdout, '');
  await assert.rejects(access(join(copied, '.scout')));
});

test('actual provider fails offline on a missing model before SQLite creation', async t => {
  const cwd = await directory(t);
  const serviceURL = new URL('../src/embeddings/index.mjs', import.meta.url).href;
  const profileURL = new URL('../src/embeddings/config.mjs', import.meta.url).href;
  const code = `globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };
    const {createEmbeddingService} = await import(${JSON.stringify(serviceURL)});
    const {loadProfile} = await import(${JSON.stringify(profileURL)});
    await createEmbeddingService((await loadProfile()).profile, {dataDir:'.scout'});`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd, encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /MODEL_UNAVAILABLE/);
  assert.doesNotMatch(child.stderr, /NETWORK_FORBIDDEN/);
  assert.equal(child.stdout, '');
  await assert.rejects(access(join(cwd, '.scout', 'scout.sqlite')));
});
