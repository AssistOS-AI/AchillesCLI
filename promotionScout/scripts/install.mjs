#!/usr/bin/env node
// The agent's install step (manifest profiles.default.install): configuration, SQLite, the local embedding model and
// RSSHub in the data directory. Ploinky runs it before every agent start; completed steps are quick no-ops.
import { bootstrap } from '../src/app/bootstrap.mjs';
import { checkRuntime } from '../src/runtime.mjs';

const safe = value => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
const report = message => console.error(`[promotionScout install] ${safe(message)}`);

try {
  checkRuntime();
  await bootstrap({}, report);
} catch (error) {
  report(`${error.code ?? 'SCOUT_ERROR'}: ${error.message}`);
  process.exitCode = 1;
}
