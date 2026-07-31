#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    cancelLoginFlow,
    createLoginFlow,
    readLoginFlow,
    respondToLoginFlow,
} from './login-flow-store.mjs';
import { readContinuationRecord } from './continuation-store.mjs';
import { createPiModelRuntime, piProviderDescriptors } from './pi-model-runtime.mjs';

async function readInput() {
    let raw = '';
    for await (const chunk of process.stdin.setEncoding('utf8')) raw += chunk;
    const payload = JSON.parse(raw || '{}');
    if (payload?.tool && payload.tool !== 'task-session-control') throw new Error('unexpected_tool');
    return payload?.input && typeof payload.input === 'object' ? payload.input : payload;
}

async function main() {
    const input = await readInput();
    const operation = String(input?.operation || '');
    readContinuationRecord(String(input?.handle || '').trim());
    if (operation === 'login_status') return output(readLoginFlow(input.flowId));
    if (operation === 'login_respond') return output(await respondToLoginFlow(input.flowId, input.secretResponse || input.response));
    if (operation === 'login_cancel') return output(cancelLoginFlow(input.flowId));

    const runtime = await createPiModelRuntime();
    const providers = piProviderDescriptors(runtime);
    if (operation === 'login_describe') return output({ type: 'login-catalog', version: 1, providers });
    if (operation !== 'login_start') throw new Error('unsupported_login_operation');
    const provider = providers.find((entry) => entry.key === String(input.provider || ''));
    const method = provider?.methods.find((entry) => entry.key === String(input.method || ''));
    if (!provider || !method) throw new Error('unsupported_login_method');
    const workerPath = fileURLToPath(new URL('./pi-login-worker.mjs', import.meta.url));
    return output({
        type: 'login-flow',
        version: 1,
        ...createLoginFlow({ provider: provider.key, method: method.key, workerPath, workerArgs: [provider.key, method.key] }),
    });
}

function output(value) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        process.stderr.write(`${error?.message || error}\n`);
        process.exitCode = 1;
    });
}
