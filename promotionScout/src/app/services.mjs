import { spawn } from 'node:child_process';
import { open, mkdir, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fail } from '../embeddings/config.mjs';
import { httpUrl } from '../providers/http.mjs';
import { identity, matches, readRecord, terminate } from './processes.mjs';

export const serviceNames = ['rsshub'];

// Only RSSHub is managed; its health endpoint answers "ok".
export async function healthy(name, base) {
  try {
    const response = await fetch(new URL('healthz', base.endsWith('/') ? base : base + '/'),
      { signal: AbortSignal.timeout(1500), redirect: 'error' });
    if (!response.ok) { await response.body?.cancel(); return false; }
    return (await response.text()).trim().toLowerCase() === 'ok';
  } catch { return false; }
}

async function occupied(url) {
  return new Promise(resolve => {
    const socket = connect({ host: url.hostname, port: Number(url.port || 80) });
    const done = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => done(true)); socket.once('error', () => done(false));
    socket.setTimeout(1000, () => done(true));
  });
}

export async function ensureServer(name, settings, dataDir, report = console.log) {
  const base = settings[`${name}Url`];
  const url = httpUrl(base);
  if (await healthy(name, base)) { report(`${name}: already responding at ${base}`); return 'existing'; }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
      || url.pathname !== '/' || url.search || url.hash) {
    throw fail('SERVICE_UNAVAILABLE', `${name}: configured external URL is unavailable; no local process was started`);
  }
  const recordPath = join(dataDir, 'runtime', `${name}.json`);
  const previous = await readRecord(recordPath);
  if (previous && await matches(previous)) {
    throw fail('SERVICE_UNHEALTHY', `${name}: Scout process is running but not ready; inspect runtime/${name}.log or restart the agent, which stops it on exit`);
  }
  if (await occupied(url)) throw fail('PORT_IN_USE', `${name}: ${base} responds with the wrong protocol; port left untouched`);
  const launch = settings.services?.[name];
  if (!Array.isArray(launch?.command) || !launch.command.length
      || launch.command.some(arg => typeof arg !== 'string' || !arg)) {
    throw fail('SERVICE_SETUP_REQUIRED', `${name}: configure services.${name}.command and cwd in ${join(dataDir, 'config.json')} for your native installation. See README.md.`);
  }
  const cwd = launch.cwd ? resolve(dataDir, launch.cwd) : dataDir;
  if (launch.env && (typeof launch.env !== 'object' || Array.isArray(launch.env)
      || Object.values(launch.env).some(value => typeof value !== 'string'))) {
    throw fail('CONFIG_INVALID', `${name}: env must contain string values`);
  }
  const runtime = join(dataDir, 'runtime');
  await mkdir(runtime, { recursive: true });
  const env = { ...process.env, ...launch.env };
  Object.assign(env, { PORT: url.port || '80', CACHE_TYPE: 'memory', NODE_ENV: 'production', LISTEN_INADDR_ANY: '0',
    ENABLE_CLUSTER: 'false' });
  const logPath = join(runtime, `${name}.log`);
  const log = await open(logPath, 'a', 0o600);
  let child;
  try {
    report(`${name}: starting local server; log: ${logPath}`);
    child = spawn(launch.command[0], launch.command.slice(1), { cwd, env, detached: true,
      stdio: ['ignore', log.fd, log.fd], shell: false });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  } catch (error) {
    throw fail('SERVICE_START_FAILED', `${name}: cannot launch command (${error.code}); check installed executable and cwd`);
  } finally { await log.close(); }
  const record = await identity(child.pid);
  child.unref();
  if (!record) throw fail('SERVICE_START_FAILED', `${name}: exited immediately; inspect ${logPath}`);
  try {
    await writeFile(recordPath, JSON.stringify({ ...record, name, url: base }), { mode: 0o600 });
    const deadline = Date.now() + (launch.startupTimeoutMs ?? 30000);
    while (Date.now() < deadline) {
      if (!await matches(record)) throw fail('SERVICE_START_FAILED', `${name}: exited; inspect ${logPath}`);
      if (await healthy(name, base)) { report(`${name}: ready at ${base}`); return 'started'; }
      await delay(200);
    }
    throw fail('SERVICE_TIMEOUT', `${name}: startup timed out; inspect ${logPath}`);
  } catch (error) {
    await terminate(record);
    await unlink(recordPath).catch(() => {});
    throw error;
  }
}

export async function stopServers(dataDir, report = console.log) {
  for (const name of serviceNames) {
    const path = join(dataDir, 'runtime', `${name}.json`);
    const record = await readRecord(path);
    if (!record) { report(`${name}: no Scout-owned process`); continue; }
    const stopped = await terminate(record);
    await unlink(path);
    report(`${name}: ${stopped ? 'stopped' : 'stale record removed; no process signalled'}`);
  }
}
