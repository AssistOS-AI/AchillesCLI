import { setTimeout as delay } from 'node:timers/promises';
import { fail } from '../embeddings/config.mjs';
import { ensureServer, serviceNames } from '../app/services.mjs';
import { controlKeys, dueAt, monitoring } from '../app/control.mjs';

export const cycleTool = 'scout_run_cycle';
const terminal = new Set(['completed', 'failed', 'cancelled', 'not_found']);

// Resolves when a shutdown signal arrives or the process hits an unhandled error.
export function shutdownSignal(target = process) {
  return new Promise(resolve => {
    const handlers = {};
    const finish = (reason, error) => {
      for (const [event, handler] of Object.entries(handlers)) target.off(event, handler);
      resolve({ reason, error });
    };
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) handlers[signal] = () => finish(signal);
    handlers.uncaughtException = error => finish('error', error);
    handlers.unhandledRejection = error => finish('error', error);
    for (const [event, handler] of Object.entries(handlers)) target.on(event, handler);
  });
}

// The long-lived part of the agent: it keeps RSSHub running and starts each due cycle as an asynchronous
// scout_run_cycle task through the router (`client` is a Ploinky AgentMcpClient for this agent). It holds no
// monitoring state of its own; everything is read from and written to SQLite settings.
export class Daemon {
  constructor({ store, settings, dataDir, client, report = console.error, now = Date.now, serviceCheckMs = 30000,
    retryMs = 30000, cancelAfterMs = 60000, startService = ensureServer }) {
    Object.assign(this, { store, settings, dataDir, client, report, now, serviceCheckMs, retryMs, cancelAfterMs, startService });
    this.services = {};
    this.serviceCheckedAt = -Infinity;
    this.retryAt = 0;
    this.stopSeenAt = null;
  }

  // ensureServer reuses a healthy service and restarts one that died.
  async checkServices() {
    this.serviceCheckedAt = this.now();
    for (const name of serviceNames) {
      try {
        await this.startService(name, this.settings, this.dataDir, this.report);
        this.services[name] = { state: 'running' };
      } catch (error) {
        const message = `${error.code ?? 'SERVICE_ERROR'}: ${error.message}`;
        if (this.services[name]?.message !== message) this.report(message);
        this.services[name] = { state: 'failed', message };
      }
    }
  }

  async tick() {
    if (this.now() - this.serviceCheckedAt >= this.serviceCheckMs) await this.checkServices();
    try { await this.followCycle(); }
    catch (error) {
      this.report(`Cycle control: ${error.code ?? 'SCOUT_ERROR'}: ${error.message}; retrying in ${this.retryMs / 1000}s`);
      this.retryAt = this.now() + this.retryMs;
    }
    this.store.saveSetting(controlKeys.daemon, { pid: process.pid, heartbeatAt: new Date(this.now()).toISOString(),
      services: this.services });
  }

  async followCycle() {
    const { store } = this;
    const taskId = store.setting(controlKeys.taskId);
    if (taskId) return this.followTask(taskId);
    this.stopSeenAt = null;
    if (!monitoring(store) || this.now() < Math.max(dueAt(store), this.retryAt)) return;
    const result = await this.client.callToolWithoutWait(cycleTool, {});
    const id = result?.metadata?.taskId;
    if (!id) throw fail('CYCLE_START_FAILED', `${cycleTool} returned no task id`);
    store.transaction(() => {
      store.saveSetting(controlKeys.taskId, id);
      store.saveSetting(controlKeys.lastStartedAt, new Date(this.now()).toISOString());
    });
    this.report(`Cycle started as task ${id}`);
  }

  async followTask(taskId) {
    const { store } = this;
    let task;
    try { task = await this.client.getTaskStatus(taskId); }
    catch (error) {
      // A task queue that restarted without its record no longer knows the task.
      if (!/status 404/.test(error.message)) throw error;
      task = { status: 'not_found' };
    }
    if (terminal.has(task?.status)) {
      // A killed or cancelled task cannot finish its run record itself.
      store.transaction(() => {
        store.closeInterruptedRuns();
        store.saveSetting(controlKeys.taskId, null);
        store.saveSetting(controlKeys.lastTaskId, taskId);
      });
      this.report(`Cycle task ${taskId}: ${task.status}`);
      return;
    }
    // The cycle aborts itself when Stop clears the flag; cancel it only if it does not.
    if (monitoring(store)) { this.stopSeenAt = null; return; }
    this.stopSeenAt ??= this.now();
    if (this.now() - this.stopSeenAt >= this.cancelAfterMs) {
      await this.client.cancelTask(taskId);
      this.report(`Cycle task ${taskId}: cancelled after Stop`);
      this.stopSeenAt = this.now();
    }
  }

  async run(stopped, { tickMs = 2000 } = {}) {
    let done = false;
    const finished = stopped.then(value => { done = true; return value; });
    while (!done) {
      try { await this.tick(); } catch (error) { this.report(`Daemon: ${error.code ?? 'SCOUT_ERROR'}: ${error.message}`); }
      await Promise.race([delay(tickMs), finished]);
    }
    return finished;
  }
}
