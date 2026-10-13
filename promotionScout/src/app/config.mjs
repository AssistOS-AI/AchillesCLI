import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fail } from '../embeddings/config.mjs';

export const defaults = {
  services: {
    rsshub: { command: [], cwd: null, env: {}, startupTimeoutMs: 30000 },
  },
  rsshubUrl: 'http://127.0.0.1:1200',
  timeoutMs: 20000,
  userAgent: 'PromotionScout/0.2 (+local RSS monitor)',
};

export async function initialize(dataDir) {
  await mkdir(dataDir, { recursive: true });
  const path = join(dataDir, 'config.json');
  try { await writeFile(path, JSON.stringify(defaults, null, 2) + '\n', { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  return path;
}

export async function loadSettings(dataDir, env = process.env) {
  let saved = {};
  try { saved = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const settings = { ...defaults, ...saved, services: { ...defaults.services, ...saved.services } };
  if (env.RSSHUB_URL) settings.rsshubUrl = env.RSSHUB_URL;
  if (!Number.isSafeInteger(settings.timeoutMs) || settings.timeoutMs < 1 || settings.timeoutMs > 120000) {
    throw fail('CONFIG_INVALID', 'timeoutMs must be 1..120000');
  }
  for (const [name, launch] of Object.entries(settings.services ?? {})) {
    if (launch.startupTimeoutMs !== undefined && (!Number.isSafeInteger(launch.startupTimeoutMs)
        || launch.startupTimeoutMs < 100 || launch.startupTimeoutMs > 120000)) {
      throw fail('CONFIG_INVALID', `${name}: startupTimeoutMs must be 100..120000`);
    }
  }
  return settings;
}
