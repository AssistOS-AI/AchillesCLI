import { readFile, writeFile, mkdir, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fail } from '../embeddings/config.mjs';

export async function identity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) return null;
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (fields[0] === 'Z') return null;
    return { pid, group: Number(fields[2]), start: fields[19], boot: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim() };
  } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return null; throw error; }
}

export async function matches(record) {
  const actual = await identity(record?.pid);
  return Boolean(actual && actual.start === record.start && actual.boot === record.boot);
}

export async function readRecord(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// One Scout process per data directory. A lock whose recorded process is gone (it exited, was killed, or ran before
// the last reboot) protects nothing and is replaced automatically; process identity checks prevent a reused PID
// from looking alive. A corrupt lock file counts as stale.
export async function withLifecycleLock(dataDir, work, report = () => {}) {
  if (process.platform !== 'linux') throw fail('PLATFORM_UNSUPPORTED', 'Local server lifecycle requires Linux /proc');
  await mkdir(join(dataDir, 'runtime'), { recursive: true });
  const path = join(dataDir, 'runtime', 'lifecycle.lock');
  const record = await identity(process.pid);
  for (let attempt = 0; ; attempt++) {
    try { await writeFile(path, JSON.stringify(record), { flag: 'wx', mode: 0o600 }); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const text = await readFile(path, 'utf8').catch(() => '');
      let owner = null;
      try { owner = JSON.parse(text); } catch {}
      if (await matches(owner)) {
        throw fail('STARTUP_BUSY', `Another Scout process (PID ${owner.pid}) is already running for this data directory; stop it first.`);
      }
      if (attempt > 0) throw fail('STARTUP_BUSY', `Could not replace the stale lifecycle lock ${path}; retry.`);
      // Remove only the lock that was judged stale; a lock rewritten in the meantime belongs to a live process.
      if (await readFile(path, 'utf8').catch(() => '') === text) await unlink(path).catch(() => {});
      report(`Removed a stale lifecycle lock left by ${owner?.pid ? `process ${owner.pid}` : 'an unreadable record'}`
        + `${owner?.boot && owner.boot !== record.boot ? ' before the last restart' : ''}.`);
    }
  }
  try { return await work(); } finally { await unlink(path); }
}

export async function terminate(record, graceMs = 3000) {
  if (!await matches(record)) return false;
  const leader = await identity(record.pid);
  if (leader.group !== record.pid) throw fail('PROCESS_NOT_OWNED', 'Refusing to stop a non-detached process');
  const entries = await readdir('/proc');
  const members = (await Promise.all(entries.filter(name => /^\d+$/.test(name))
    .map(name => identity(Number(name))))).filter(value => value?.group === record.pid);
  const send = async (member, signal) => {
    if (!await matches(member)) return;
    try { process.kill(member.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  await Promise.all(members.map(member => send(member, 'SIGTERM')));
  const living = async () => (await Promise.all(members.map(matches))).some(Boolean);
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && await living()) await delay(50);
  if (await living()) {
    await Promise.all(members.map(member => send(member, 'SIGKILL')));
    for (let i = 0; i < 40 && await living(); i++) await delay(50);
    if (await living()) throw fail('STOP_FAILED', 'Owned processes did not stop');
  }
  return true;
}
