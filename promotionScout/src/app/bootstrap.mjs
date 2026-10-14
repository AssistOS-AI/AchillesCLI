import { resolve, join, dirname } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { initialize, loadSettings } from './config.mjs';
import { openStore } from './store.mjs';
import { loadProfile, fail } from '../embeddings/config.mjs';
import { providers } from '../embeddings/index.mjs';
import { installServices } from './install.mjs';
import { withLifecycleLock } from './processes.mjs';
import { resolveDataDir } from './paths.mjs';
import { missingDependencies } from './dependencies.mjs';

// Downloads the model once and records it with a marker, so later install steps skip loading it. The install step never
// runs inference: the model is loaded only inside a cycle, which fails explicitly if it cannot be used.
export async function prepareModel(profile, dataDir, report = console.log, registry = providers, download = false) {
  const implementation = registry[profile.provider];
  if (!implementation) throw fail('PROVIDER_UNKNOWN', `Unknown provider: ${profile.provider}`);
  const cacheDir = join(dataDir, 'models');
  const identity = JSON.stringify({ provider: profile.provider, model: profile.model, revision: profile.revision, dtype: profile.dtype });
  const marker = join(cacheDir, '.prepared', `${createHash('sha256').update(identity).digest('hex')}.json`);
  if (await readFile(marker, 'utf8').then(text => text === identity, () => false)) {
    report('Model: already downloaded');
    return;
  }
  let provider;
  try { provider = await implementation.create(profile, { cacheDir }); }
  catch (error) {
    if (error.code !== 'MODEL_UNAVAILABLE') throw error;
    if (!download) throw fail('MODEL_UNAVAILABLE', 'Model is unavailable. Restart the agent so its install step downloads it.');
    report('Model: downloading required files; this can take several minutes...');
    provider = await implementation.create(profile, { cacheDir, download: true });
  }
  await provider.dispose();
  await mkdir(dirname(marker), { recursive: true });
  await writeFile(marker, identity);
  report('Model: downloaded; the first cycle loads it for inference');
}

// The agent's install step, run before every agent start: prepares configuration, SQLite, the model and RSSHub in the
// data directory. Ploinky installs the npm dependencies; only this step downloads. Completed steps are quick no-ops.
export async function bootstrap(values = {}, report = console.log, { missing = missingDependencies() } = {}) {
  if (missing.length) throw fail('SETUP_REQUIRED', `npm dependencies are missing (${missing.join(', ')}).`);
  const dataDir = resolve(values['data-dir'] ?? resolveDataDir());
  return withLifecycleLock(dataDir, async () => {
    report(`Preparing Scout in ${dataDir}`);
    await initialize(dataDir);
    const settings = await loadSettings(dataDir);
    const store = await openStore(dataDir);
    store.close();
    report('Configuration and SQLite: ready');
    const errors = [];
    const step = async work => {
      try { await work(); } catch (error) { errors.push(error); report(`${error.code ?? 'SETUP_ERROR'}: ${error.message}`); }
    };
    await step(async () => { const { profile } = await loadProfile(values); await prepareModel(profile, dataDir, report, providers, true); });
    await step(() => installServices(dataDir, settings, report));
    if (errors.length) throw fail('SETUP_INCOMPLETE', 'Resolve the problems above and restart the agent. Successful steps are retained.');
    report('Initialization complete.');
  }, report);
}
