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
import { openCodeJson, startOpenCodeControlServer } from './opencode-control-server.mjs';

async function readInput() {
    let raw = '';
    for await (const chunk of process.stdin.setEncoding('utf8')) raw += chunk;
    const payload = JSON.parse(raw || '{}');
    if (payload?.tool && payload.tool !== 'task-session-control') throw new Error('unexpected_tool');
    return payload?.input && typeof payload.input === 'object' ? payload.input : payload;
}

function providerCatalog(methodsByProvider) {
    return Object.entries(methodsByProvider || {}).map(([provider, methods]) => ({
        key: provider,
        label: provider,
        methods: methods.map((method, index) => ({
            key: method.type === 'api' ? `api_key:${index}` : `oauth:${index}`,
            label: String(method.label || (method.type === 'api' ? 'API key' : 'Browser / OAuth')),
            secret: method.type === 'api',
            prompts: Array.isArray(method.prompts) ? method.prompts : [],
        })),
    })).filter((provider) => provider.methods.length);
}

function providerInputs(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const entries = Object.entries(raw);
    if (entries.length > 20) throw new Error('too_many_provider_inputs');
    return Object.fromEntries(entries.map(([rawKey, rawValue]) => {
        const key = String(rawKey || '').trim();
        const value = String(rawValue ?? '');
        if (!/^[A-Za-z0-9_.-]{1,100}$/.test(key)) throw new Error('invalid_provider_input_key');
        if (value.length > 4000) throw new Error('provider_input_too_long');
        return [key, value];
    }));
}

async function withServer(operation) {
    const server = await startOpenCodeControlServer();
    try { return await operation(server); } finally { await server.close(); }
}

async function main() {
    const input = await readInput();
    const operation = String(input?.operation || '');
    readContinuationRecord(String(input?.handle || '').trim());
    if (operation === 'login_status') return output(readLoginFlow(input.flowId));
    if (operation === 'login_respond') return output(await respondToLoginFlow(input.flowId, input.secretResponse || input.response));
    if (operation === 'login_cancel') return output(cancelLoginFlow(input.flowId));
    const catalog = await withServer(async (server) => providerCatalog(await openCodeJson(server, '/provider/auth')));
    if (operation === 'login_describe') return output({ type: 'login-catalog', version: 1, providers: catalog });
    if (operation !== 'login_start') throw new Error('unsupported_login_operation');
    const provider = catalog.find((entry) => entry.key === String(input.provider || ''));
    const method = provider?.methods.find((entry) => entry.key === String(input.method || ''));
    if (!provider || !method) throw new Error('unsupported_login_method');
    const [kind, index] = method.key.split(':');
    const inputs = providerInputs(input?.inputs);
    if (kind === 'api_key') {
        const apiKey = String(input.apiKey || '');
        if (!apiKey) throw new Error('api_key_required');
        await withServer((server) => openCodeJson(server, `/auth/${encodeURIComponent(provider.key)}`, {
            method: 'PUT',
            body: JSON.stringify({ type: 'api', key: apiKey, ...(Object.keys(inputs).length ? { metadata: inputs } : {}) }),
        }));
        return output({ type: 'login-flow', version: 1, status: 'completed', provider: provider.key, method: method.key });
    }
    const workerPath = fileURLToPath(new URL('./opencode-login-worker.mjs', import.meta.url));
    return output({
        type: 'login-flow',
        version: 1,
        ...createLoginFlow({
            provider: provider.key,
            method: method.key,
            workerPath,
            workerArgs: [provider.key, index, Buffer.from(JSON.stringify(inputs)).toString('base64url')],
        }),
    });
}

function output(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        process.stderr.write(`${error?.message || error}\n`);
        process.exitCode = 1;
    });
}
