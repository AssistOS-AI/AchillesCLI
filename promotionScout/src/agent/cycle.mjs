import { setTimeout as delay } from 'node:timers/promises';
import { fail } from '../embeddings/config.mjs';
import { createEmbeddingService } from '../embeddings/index.mjs';
import { healthy, serviceNames } from '../app/services.mjs';
import { runCycle } from '../app/monitor.mjs';
import { monitoring } from '../app/control.mjs';
import { openContext } from './context.mjs';

// The daemon owns RSSHub; a cycle only waits for it to answer.
export async function waitForServices(settings, signal, { pause = 500 } = {}) {
  for (const name of serviceNames) {
    const url = settings[`${name}Url`];
    const deadline = Date.now() + (settings.services?.[name]?.startupTimeoutMs ?? 30000);
    while (!await healthy(name, url)) {
      signal?.throwIfAborted();
      if (Date.now() >= deadline) throw fail('SERVICE_UNAVAILABLE', `${name}: not responding at ${url}; the agent starts it`);
      await delay(pause);
    }
  }
}

// One cycle with the model loaded in this process only. Stop (the cleared monitoring flag) or task cancellation
// aborts it; the run record stays.
export async function runCycleTask({ report = () => {}, signal, pollMs = 2000, ...options } = {}) {
  const context = await openContext(options);
  const controller = new AbortController();
  const abort = reason => { if (!controller.signal.aborted) controller.abort(reason); };
  signal?.addEventListener('abort', () => abort(signal.reason), { once: true });
  const watch = setInterval(() => {
    if (!monitoring(context.store)) abort(fail('ABORTED', 'Monitoring was stopped'));
  }, pollMs);
  try {
    const { store, settings, profile, dataDir, registry, threshold, subtopicThreshold } = context;
    return await runCycle({ store, settings, report, signal: controller.signal, ...(options.search ? { search: options.search } : {}),
      createService: async () => Object.assign(await createEmbeddingService(profile, { dataDir, registry }),
        { threshold, subtopicThreshold }),
      ensureServices: cycleSignal => (options.ensureServices ?? waitForServices)(settings, cycleSignal) });
  } finally {
    clearInterval(watch);
    context.close();
  }
}
