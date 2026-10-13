import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, readFile, writeFile, rename, open } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fail } from '../embeddings/config.mjs';
import { healthy, serviceNames } from './services.mjs';
import { matches, readRecord } from './processes.mjs';

const exec = promisify(execFile);
const manifest = JSON.parse(await readFile(new URL('../../config/services/install.json', import.meta.url), 'utf8'));
const exists = path => access(path).then(() => true, () => false);

export async function runInstall(command, args, cwd, logPath, report = console.log) {
  const log = await open(logPath, 'a', 0o600);
  report(`Installing: ${command.split('/').at(-1)} ${args.slice(0, 2).join(' ')}; log: ${logPath}`);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
        PUPPETEER_SKIP_DOWNLOAD: '1', CI: 'true',
        npm_config_cache: join(dirname(logPath), '../services/cache/npm'),
        npm_config_devdir: join(dirname(logPath), '../services/cache/node-gyp') }, stdio: ['ignore', log.fd, log.fd], detached: true });
      const timer = setTimeout(() => {
        try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      }, 15 * 60 * 1000);
      const progress = setInterval(() => report('Installation still running...'), 30000);
      const finish = error => { clearTimeout(timer); clearInterval(progress); error ? reject(error) : resolve(); };
      child.once('error', error => finish(fail('INSTALL_FAILED', `${error.code}; inspect ${logPath}`)));
      child.once('exit', code => finish(code === 0 ? null : fail('INSTALL_FAILED', `Installer exited ${code}; inspect ${logPath}`)));
    });
  } finally { await log.close(); }
}

async function prerequisites(name) {
  try {
    await exec('git', ['--version'], { timeout: 5000 });
    const [major, minor, patch] = process.versions.node.split('.').map(Number);
    if (!((major === 22 && (minor > 22 || minor === 22 && patch >= 2))
        || (major === 24 && minor >= 15))) throw Error('RSSHub requires Node 22.22.2+ in v22 or 24.15+ in v24');
    await exec('npm', ['--version'], { timeout: 5000 });
    for (const tool of ['python3', 'make', 'g++']) await exec(tool, ['--version'], { timeout: 5000 });
  } catch (error) {
    throw fail('INSTALL_PREREQUISITE', `${name}: requires Git, npm, Python, make, g++ and Node 22.22.2+ (v22) or 24.15+ (v24). ${error.message}`);
  }
}

export function managedLaunch(name, dataDir) {
  const cwd = join(dataDir, 'services', name);
  return { command: [process.execPath, '--max-http-header-size=32768', join(cwd, 'dist/index.mjs')],
    cwd, env: {}, startupTimeoutMs: 120000, managedRevision: manifest[name].revision };
}

export async function installServices(dataDir, settings, report = console.log) {
  const failures = [];
  for (const name of serviceNames) {
    try { await installService(name, dataDir, settings, report); }
    catch (error) { failures.push(error); report(`${error.code ?? 'INSTALL_FAILED'}: ${error.message}`); }
  }
  if (failures.length) throw fail('INSTALL_INCOMPLETE', 'Service installation incomplete. Fix the errors and restart the agent.');
}

async function installService(name, dataDir, settings, report) {
  const configured = settings.services?.[name];
  const spec = manifest[name], target = join(dataDir, 'services', name);
  if (configured?.command?.length && !configured.managedRevision) {
    report(`${name}: using custom installation; left unchanged`); return;
  }
  const address = new URL(settings[`${name}Url`]);
  const local = address.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(address.hostname);
  if (!local || !configured?.managedRevision && await healthy(name, address.href)) {
    report(`${name}: using configured service; no installation needed`); return;
  }
  const launch = managedLaunch(name, dataDir);
  let head;
  try { head = (await exec('git', ['rev-parse', 'HEAD'], { cwd: target, timeout: 5000 })).stdout.trim(); } catch {}
  if (head && head !== spec.revision) throw fail('INSTALL_CONFLICT', `${name}: checkout differs from pinned revision; left unchanged`);
  const marker = await readRecord(join(target, '.scout-installed.json'));
  const artifact = 'dist/index.mjs';
  if (head === spec.revision && marker?.revision === spec.revision && await exists(join(target, artifact))) {
    await saveLaunch(dataDir, name, launch); report(`${name}: already installed`); return;
  }
  if (await matches(await readRecord(join(dataDir, 'runtime', `${name}.json`)))) {
    throw fail('SERVICE_RUNNING', `Stop the agent before repairing ${name}`);
  }
  await prerequisites(name);
  await mkdir(target, { recursive: true });
  const logPath = join(dataDir, 'runtime', `${name}-install.log`);
  const run = (cmd, args, cwd = target) => runInstall(cmd, args, cwd, logPath, report);
  if (!await exists(join(target, '.git'))) await run('git', ['init']);
  if (!head) {
    await run('git', ['-c', 'core.hooksPath=/dev/null', 'fetch', '--depth=1', spec.repository, spec.revision]);
    await run('git', ['-c', 'core.hooksPath=/dev/null', 'checkout', '--detach', 'FETCH_HEAD']);
  }
  const tools = join(dataDir, 'services', 'tools');
  await mkdir(tools, { recursive: true });
  const pnpm = join(tools, 'node_modules/pnpm/bin/pnpm.cjs');
  await run('npm', ['install', '--prefix', tools, '--ignore-scripts',
    '--no-audit', '--no-fund', `pnpm@${spec.pnpm}`], tools);
  await run(process.execPath, [pnpm, 'install', '--frozen-lockfile', '--store-dir', join(dataDir, 'services/pnpm-store')]);
  await run(process.execPath, [pnpm, 'run', 'build']);
  if (!await exists(join(target, artifact))) throw fail('INSTALL_FAILED', `${name}: missing build output; inspect ${logPath}`);
  await writeFile(join(target, '.scout-installed.json'), JSON.stringify({ revision: spec.revision }));
  await saveLaunch(dataDir, name, launch);
  report(`${name}: installed locally`);
}

async function saveLaunch(dataDir, name, launch) {
  const path = join(dataDir, 'config.json');
  const config = JSON.parse(await readFile(path, 'utf8'));
  config.services = { ...config.services, [name]: launch };
  await writeFile(path + '.tmp', JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  await rename(path + '.tmp', path);
}
