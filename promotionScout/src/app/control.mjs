import { fail } from '../embeddings/config.mjs';
import { intervalChoices, validInterval } from './monitor.mjs';

// Monitoring is controlled through SQLite settings: MCP tools write the operator's choice, the agent daemon reads it,
// starts each cycle as an asynchronous task and records that task. The choice survives agent restarts.
export const controlKeys = Object.freeze({
  running: 'monitor:running', lastStartedAt: 'monitor:lastStartedAt', taskId: 'monitor:taskId',
  lastTaskId: 'monitor:lastTaskId', daemon: 'monitor:daemon',
});
const hourMs = 3600000;
const fallbackInterval = 1;

// A saved interval that is no longer offered falls back to hourly.
export function intervalHours(store) {
  const saved = store.setting('intervalHours', fallbackInterval);
  return intervalChoices.includes(saved) ? saved : fallbackInterval;
}

export const monitoring = store => store.setting(controlKeys.running, false) === true;

export function currentRun(store) {
  return store.db.prepare("SELECT MAX(id) AS id FROM runs WHERE status='running'").get().id ?? null;
}

export function startMonitoring(store, hours) {
  validInterval(hours);
  if (monitoring(store)) throw fail('MONITOR_RUNNING', 'Monitoring is already running; stop it before changing the interval.');
  if (currentRun(store) || store.setting(controlKeys.taskId)) {
    throw fail('MONITOR_STOPPING', 'The previous cycle is still stopping; retry in a moment.');
  }
  // No previous start makes the first cycle due immediately.
  store.transaction(() => {
    store.saveSetting('intervalHours', hours);
    store.saveSetting(controlKeys.lastStartedAt, null);
    store.saveSetting(controlKeys.running, true);
  });
}

// The running cycle notices the cleared flag and aborts; the daemon starts no further cycle.
export function stopMonitoring(store) {
  store.saveSetting(controlKeys.running, false);
}

// Epoch milliseconds when the next cycle is due, or null while monitoring is off.
export function dueAt(store) {
  if (!monitoring(store)) return null;
  const last = store.setting(controlKeys.lastStartedAt);
  return last ? Date.parse(last) + intervalHours(store) * hourMs : 0;
}

export function monitorStatus(store, now = Date.now()) {
  const run = currentRun(store), task = store.setting(controlKeys.taskId), due = dueAt(store);
  return {
    monitoring: monitoring(store), intervalHours: intervalHours(store), cycleRunning: Boolean(run || task),
    currentRun: run, currentTaskId: task, lastTaskId: store.setting(controlKeys.lastTaskId),
    lastRunId: store.db.prepare("SELECT MAX(id) AS id FROM runs WHERE status!='running'").get().id ?? null,
    nextRunAt: due === null || run || task ? null : new Date(Math.max(due, now)).toISOString(),
    daemon: store.setting(controlKeys.daemon),
  };
}
