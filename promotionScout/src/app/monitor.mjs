import { fail } from '../embeddings/config.mjs';
import { activeTopics } from './topics.mjs';
import { searchTopics } from './search.mjs';

// Offered cadences in hours: hourly to every 12 hours, daily, every two days and weekly.
export const intervalChoices = Object.freeze([1, 2, 4, 6, 8, 12, 24, 48, 168]);

export function validInterval(value) {
  if (!intervalChoices.includes(value)) {
    throw fail('INPUT_INVALID', `Interval must be one of ${intervalChoices.join(', ')} hours.`);
  }
  return value;
}

// Runs one collection and ranking cycle and records it as a run. Aborting the signal stops it between requests
// and items; the run keeps its record with status aborted.
export async function runCycle({ store, settings, createService, ensureServices, search = searchTopics,
  report = () => {}, signal = new AbortController().signal, now = Date.now }) {
  const started = now();
  const run = store.startRun();
  const errors = [];
  let service, stats = {}, status = 'ok';
  report(`Run ${run}: started`);
  try {
    let topics = activeTopics(store);
    if (!topics.length) {
      report('No active topics. Add one in the Topics tab.');
    } else {
      service = await createService();
      signal.throwIfAborted();
      topics = await checkTopics(service, topics, errors, report);
      signal.throwIfAborted();
      // RSSHub is needed only when a due feed uses it; its failure affects only RSSHub feeds.
      const result = await search(store, service, settings,
        { now: started, report, signal, topics, run, ensureRsshub: () => ensureServices(signal) });
      stats = result.stats;
      errors.push(...result.errors);
      if (errors.length) status = 'partial';
    }
  } catch (error) {
    status = signal.aborted ? 'aborted' : 'failed';
    if (!signal.aborted) errors.push(`${error.code ?? 'SCOUT_ERROR'}: ${error.message}`);
    report(signal.aborted ? `Run ${run}: aborted` : `${error.code ?? 'SCOUT_ERROR'}: ${error.message}`);
  } finally {
    try { await service?.dispose(); } catch (error) { errors.push(`Model release failed: ${error.message}`); }
    store.finishRun(run, status, stats, errors);
  }
  report(`Run ${run}: ${status}; ${stats.newResults ?? 0} new result(s), ${errors.length} error(s).`);
  return { run, status, stats, errors };
}

// A topic too long for the model is reported and excluded; other inference failures stop the cycle.
async function checkTopics(service, topics, errors, report) {
  const valid = [];
  for (const topic of topics) {
    try { await service.embed([topic.label], 'query'); valid.push(topic); }
    catch (error) {
      if (error.code !== 'TEXT_TOO_LONG') throw error;
      const message = `${topic.label}: ${error.message}`;
      errors.push(message); report(message);
    }
  }
  return valid;
}
