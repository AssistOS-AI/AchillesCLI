#!/usr/bin/env node
// MCP tool entry: AgentServer starts one process per call with {tool, input, metadata} as one JSON line on stdin.
// argv[2] names the operation; the result is printed as JSON. Expected failures are returned as {error}, not thrown.
import { operations } from '../src/agent/operations.mjs';
import { openContext } from '../src/agent/context.mjs';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Compares real paths: /code is a tree of symlinks, and whether import.meta.url keeps the /code path depends on Node's
// symlink options.
const isEntry = () => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
};
const readStdin = async () => { let raw = ''; for await (const chunk of process.stdin) raw += chunk; return raw; };

export async function runOperation(name, input = {}, options = {}) {
  const operation = operations[name];
  if (!operation) return { error: { code: 'USAGE', message: `Unknown operation: ${name}` } };
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: { code: 'INPUT_INVALID', message: 'Tool input must be an object' } };
  }
  const context = await openContext(options);
  try { return await operation(context, input); }
  catch (error) {
    if (!error.code) throw error;
    return { error: { code: error.code, message: error.message } };
  } finally { context.close(); }
}

if (isEntry()) {
  try {
    const raw = await readStdin();
    const payload = raw.trim() ? JSON.parse(raw) : {};
    const result = await runOperation(process.argv[2], payload.input ?? payload.arguments ?? {});
    process.stdout.write(JSON.stringify(result ?? null) + '\n');
  } catch (error) {
    process.stderr.write(`${error.code ?? 'SCOUT_ERROR'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
