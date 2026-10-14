#!/usr/bin/env node
// Entry point: node scripts/run.mjs --input '<JSON>'
import { parseArgs } from 'node:util';
import { action } from './action.mjs';
import { createScoutClient } from './scoutMcpClient.mjs';

try {
  const { values } = parseArgs({ options: { input: { type: 'string' } }, strict: true, allowPositionals: false });
  if (values.input === undefined) throw new Error("Usage: node scripts/run.mjs --input '<JSON>'");
  console.log(await action(values.input, await createScoutClient()));
} catch (error) {
  console.error(error?.code ? `${error.code}: ${error.message}` : error?.message || 'Skill execution failed.');
  process.exitCode = 1;
}
