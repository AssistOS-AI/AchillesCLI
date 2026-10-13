#!/usr/bin/env node
// scout_run_cycle: one monitoring cycle as an asynchronous Ploinky task, started only by the agent daemon.
// Progress lines go to stderr, which the task queue exposes as the task's live log; the summary goes to stdout.
import { runCycleTask } from '../src/agent/cycle.mjs';

const safe = value => String(value ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, ' ');
const report = message => process.stderr.write(`${new Date().toISOString()}  ${safe(message)}\n`);

try {
  for await (const _ of process.stdin) { /* the cycle takes no input */ }
  const controller = new AbortController();
  // Task cancellation signals the process group; let the cycle record its run as aborted.
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => controller.abort(Object.assign(
    new Error('The cycle task was cancelled'), { code: 'ABORTED' })));
  const result = await runCycleTask({ report, signal: controller.signal });
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (error) {
  report(`${error.code ?? 'SCOUT_ERROR'}: ${error.message}`);
  process.exitCode = 1;
}
