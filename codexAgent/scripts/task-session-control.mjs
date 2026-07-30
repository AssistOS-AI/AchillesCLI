#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    cancelLoginFlow,
    createLoginFlow,
    readLoginFlow,
} from './login-flow-store.mjs';
import { readContinuationRecord } from './continuation-store.mjs';
import { resolveCodexBinary } from './codex-runner.mjs';

const PROVIDERS = [{
    key: 'openai',
    label: 'OpenAI / ChatGPT',
    methods: [
        { key: 'api_key', label: 'OpenAI API key', secret: true },
        { key: 'access_token', label: 'Codex access token', secret: true },
        { key: 'device_code', label: 'Browser (headless device code)' },
        { key: 'browser', label: 'Browser (local callback)' },
    ],
}];

async function readInput() {
    let raw = '';
    for await (const chunk of process.stdin.setEncoding('utf8')) raw += chunk;
    const payload = JSON.parse(raw || '{}');
    if (payload?.tool && payload.tool !== 'task-session-control') throw new Error('unexpected_tool');
    return payload?.input && typeof payload.input === 'object' ? payload.input : payload;
}

function secretLogin(flag, value, failureMessage) {
    return new Promise((resolve, reject) => {
        const child = spawn(resolveCodexBinary(), ['login', flag], {
            env: { ...process.env, HOME: process.env.HOME || '/root' },
            stdio: ['pipe', 'ignore', 'pipe'],
        });
        let stderr = '';
        child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
        child.on('error', reject);
        child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || failureMessage)));
        child.stdin.end(`${value}\n`);
    });
}

async function main() {
    const input = await readInput();
    const operation = String(input?.operation || '');
    readContinuationRecord(String(input?.handle || '').trim());
    if (operation === 'login_describe') return output({ type: 'login-catalog', version: 1, providers: PROVIDERS });
    if (operation === 'login_status') return output(readLoginFlow(input.flowId));
    if (operation === 'login_cancel') return output(cancelLoginFlow(input.flowId));
    if (operation === 'login_respond') throw new Error('login_flow_does_not_accept_response');
    if (operation !== 'login_start') throw new Error('unsupported_login_operation');
    const method = PROVIDERS[0].methods.find((entry) => entry.key === String(input.method || ''));
    if (String(input.provider || '') !== 'openai' || !method) throw new Error('unsupported_login_method');
    if (method.secret) {
        const secret = String(input.apiKey || '');
        if (!secret) throw new Error('login_secret_required');
        const accessToken = method.key === 'access_token';
        await secretLogin(
            accessToken ? '--with-access-token' : '--with-api-key',
            secret,
            accessToken ? 'Codex access-token login failed.' : 'Codex API-key login failed.',
        );
        return output({ type: 'login-flow', version: 1, status: 'completed', provider: 'openai', method: method.key });
    }
    const workerPath = fileURLToPath(new URL('./codex-login-worker.mjs', import.meta.url));
    return output({
        type: 'login-flow',
        version: 1,
        ...createLoginFlow({ provider: 'openai', method: method.key, workerPath, workerArgs: [method.key] }),
    });
}

function output(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        process.stderr.write(`${error?.message || error}\n`);
        process.exitCode = 1;
    });
}
