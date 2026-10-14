import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { ensureServer, stopServers, healthy } from '../src/app/services.mjs';
import { identity, matches, withLifecycleLock } from '../src/app/processes.mjs';
import { prepareModel } from '../src/app/bootstrap.mjs';
import { defaults } from '../src/app/config.mjs';

const quiet = () => {};
async function workspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'scout-lifecycle-'));
  await mkdir(join(dir, 'runtime'));
  t.after(async () => { await stopServers(dir, quiet); await rm(dir, { recursive: true, force: true }); });
  return dir;
}
async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve)); return port;
}
function settings(port, extra = '') {
  return { ...defaults, rsshubUrl: `http://127.0.0.1:${port}`, services: {
    rsshub: { command: [process.execPath, '-e', `require('http').createServer((q,s)=>s.end('ok')).listen(${port},'127.0.0.1');${extra}`],
      startupTimeoutMs: 3000 },
  } };
}

test('native server starts once, persists across calls and stops only its owned PID', async t => {
  const dir = await workspace(t), config = settings(await freePort());
  assert.equal(await ensureServer('rsshub', config, dir, quiet), 'started');
  const path = join(dir, 'runtime/rsshub.json');
  const first = JSON.parse(await readFile(path));
  assert.ok(await matches(first));
  assert.equal(await ensureServer('rsshub', config, dir, quiet), 'existing');
  assert.deepEqual(JSON.parse(await readFile(path)), first);
  await stopServers(dir, quiet);
  assert.equal(await matches(first), false);
  assert.equal(await healthy('rsshub', config.rsshubUrl), false);
  await stopServers(dir, quiet);
});

test('healthy server from another workspace remains unowned and survives stop', async t => {
  const owner = await workspace(t), other = await workspace(t), config = settings(await freePort());
  await ensureServer('rsshub', config, owner, quiet);
  await ensureServer('rsshub', config, other, quiet);
  await stopServers(other, quiet);
  assert.equal(await healthy('rsshub', config.rsshubUrl), true);
});

test('stale PID identity cannot kill a live server', async t => {
  const owner = await workspace(t), other = await workspace(t), config = settings(await freePort());
  await ensureServer('rsshub', config, owner, quiet);
  const record = JSON.parse(await readFile(join(owner, 'runtime/rsshub.json')));
  await writeFile(join(other, 'runtime/rsshub.json'), JSON.stringify({ ...record, start: 'incorrect' }));
  await stopServers(other, quiet);
  assert.equal(await healthy('rsshub', config.rsshubUrl), true);
});

test('failed launch and readiness timeout produce explicit errors and leave no running child', async t => {
  const dir = await workspace(t), config = settings(await freePort());
  config.services.rsshub.command = ['/no/such/server'];
  await assert.rejects(ensureServer('rsshub', config, dir, quiet), { code: 'SERVICE_START_FAILED' });
  config.services.rsshub.command = [process.execPath, '-e', 'setInterval(()=>{},1000)'];
  config.services.rsshub.startupTimeoutMs = 100;
  await assert.rejects(ensureServer('rsshub', config, dir, quiet), { code: 'SERVICE_TIMEOUT' });
  await assert.rejects(readFile(join(dir, 'runtime/rsshub.json')), { code: 'ENOENT' });
});

test('lifecycle lock excludes concurrent work and is released after failure', async t => {
  const dir = await workspace(t);
  await withLifecycleLock(dir, async () => {
    await assert.rejects(withLifecycleLock(dir, async () => {}), { code: 'STARTUP_BUSY' });
  });
  await assert.rejects(withLifecycleLock(dir, async () => { throw Error('failed'); }), /failed/);
  await withLifecycleLock(dir, async () => {});
  // A lock left by a dead process or an earlier boot, or a corrupt one, is replaced and reported.
  const lock = join(dir, 'runtime/lifecycle.lock');
  for (const stale of [{ ...(await identity(process.pid)), start: 'gone' }, { pid: 2, start: '1', boot: 'earlier-boot' }, 'not json']) {
    await writeFile(lock, typeof stale === 'string' ? stale : JSON.stringify(stale));
    const reports = [];
    assert.equal(await withLifecycleLock(dir, async () => 'ran', message => reports.push(message)), 'ran');
    assert.match(reports[0], /Removed a stale lifecycle lock/);
  }
  await assert.rejects(readFile(lock), { code: 'ENOENT' });
  assert.ok((await identity(process.pid)).start);
});

test('only the install step downloads models, once, and never runs inference', async t => {
  const dir = await workspace(t);
  let calls = [], disposed = 0;
  const profile = { provider: 'fixture', model: 'org/model', revision: 'abc', dtype: 'q8', dimensions: 2 };
  const registry = { fixture: { create: async (_profile, options) => {
    calls.push(options.download === true);
    if (!options.download) throw Object.assign(Error('missing'), { code: 'MODEL_UNAVAILABLE' });
    return { embed: async () => { throw Error('inference must not run'); }, dispose: async () => disposed++ };
  } } };
  await assert.rejects(prepareModel(profile, dir, quiet, registry), { code: 'MODEL_UNAVAILABLE' });
  assert.deepEqual(calls, [false]); calls = [];
  await prepareModel(profile, dir, quiet, registry, true);
  assert.deepEqual(calls, [false, true]); assert.equal(disposed, 1); calls = [];
  await prepareModel(profile, dir, quiet, registry, true);
  assert.deepEqual(calls, [], 'a recorded download is not loaded again');
  const failing = { fixture: { create: async () => { throw Object.assign(Error('offline'), { code: 'MODEL_DOWNLOAD_FAILED' }); } } };
  await assert.rejects(prepareModel({ ...profile, revision: 'def' }, dir, quiet, failing, true), /offline/);
  await assert.rejects(prepareModel({ ...profile, revision: 'def' }, dir, quiet, failing, true), /offline/, 'a failed download records nothing');
});

test('stop cleans up a child that ignores SIGTERM after its parent exits', async t => {
  const dir = await workspace(t), config = settings(await freePort(),
    `const kid=require('child_process').spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});require('fs').writeFileSync('kid.pid',String(kid.pid));`);
  await ensureServer('rsshub', config, dir, quiet);
  await new Promise(resolve => setTimeout(resolve, 200));
  const kid = await identity(Number(await readFile(join(dir, 'kid.pid'), 'utf8')));
  assert.ok(kid);
  await stopServers(dir, quiet);
  assert.equal(await matches(kid), false);
  assert.equal(await healthy('rsshub', config.rsshubUrl), false);
});

test('the install step refuses to run without npm dependencies, before creating configuration', async t => {
  const { bootstrap } = await import('../src/app/bootstrap.mjs');
  const { missingDependencies } = await import('../src/app/dependencies.mjs');
  const dir = await workspace(t);
  await assert.rejects(bootstrap({ 'data-dir': dir }, quiet, { missing: ['eld'] }), { code: 'SETUP_REQUIRED' });
  await assert.rejects(readFile(join(dir, 'config.json')), { code: 'ENOENT' });
  assert.deepEqual(missingDependencies(['eld']), []);
  assert.deepEqual(missingDependencies(['eld'], [dir]), ['eld']);
});

test('missing installation prerequisites fail before creating service checkouts', async t => {
  const { installServices } = await import('../src/app/install.mjs');
  const dir = await workspace(t), oldPath = process.env.PATH, reports = [];
  process.env.PATH = '';
  try {
    await assert.rejects(installServices(dir, { ...defaults, rsshubUrl: `http://127.0.0.1:${await freePort()}` },
      message => reports.push(message)), { code: 'INSTALL_INCOMPLETE' });
  } finally { process.env.PATH = oldPath; }
  assert.ok(reports.some(message => message.includes('INSTALL_PREREQUISITE')));
  await assert.rejects(readFile(join(dir, 'services/rsshub/.git/HEAD')), { code: 'ENOENT' });
});
