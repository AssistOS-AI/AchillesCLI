#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveCodexBinary } from '../scripts/codex-runner.mjs';

const REQUEST_TIMEOUT_MS = 30000;

function requestError(payload) {
    return new Error(payload?.error?.message || 'Codex app-server request failed.');
}

export function codexModelDescriptor(raw) {
    const id = String(raw?.id || raw?.model || raw?.slug || '').trim();
    if (!id) return null;
    const contextWindow = Number(raw?.contextWindow ?? raw?.context_window);
    return {
        id,
        object: 'model',
        modelId: id,
        providerModelId: id,
        displayName: String(raw?.displayName || raw?.display_name || raw?.name || id),
        contextWindow: Number.isFinite(contextWindow) ? contextWindow : null,
        maxOutputTokens: null,
        supportsTools: true,
        supportsStreaming: false,
        supportsVision: raw?.supportsImages === true || raw?.supports_images === true,
        tags: ['coding-agent'],
        metadata: {
            codexModel: id,
            description: String(raw?.description || ''),
            defaultReasoningEffort: raw?.defaultReasoningEffort || raw?.default_reasoning_effort || null,
            reasoningEfforts: raw?.supportedReasoningEfforts || raw?.supported_reasoning_efforts || [],
        },
        execution: { model: id },
    };
}

export function listCodexModels({ env = process.env, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(resolveCodexBinary(env), ['app-server', '--stdio'], {
            env: { ...process.env, ...env, HOME: env.HOME || '/root' },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { child.kill('SIGTERM'); } catch (_) { }
            if (error) reject(error);
            else resolve(value);
        };
        const timer = setTimeout(() => {
            finish(new Error(`Codex model listing timed out.${stderr.trim() ? ` ${stderr.trim()}` : ''}`));
        }, timeoutMs);
        const send = (payload) => child.stdin.write(`${JSON.stringify(payload)}\n`);
        const consumeLine = (line) => {
            let payload;
            try { payload = JSON.parse(line); } catch { return; }
            if (payload.id === 1) {
                if (payload.error) return finish(requestError(payload));
                send({ method: 'initialized' });
                send({ id: 2, method: 'model/list', params: { limit: 100 } });
                return;
            }
            if (payload.id === 2) {
                if (payload.error) return finish(requestError(payload));
                const records = Array.isArray(payload?.result?.data)
                    ? payload.result.data
                    : (Array.isArray(payload?.result?.models) ? payload.result.models : []);
                finish(null, records.map(codexModelDescriptor).filter(Boolean));
            }
        };
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
            let newline = stdout.indexOf('\n');
            while (newline >= 0) {
                consumeLine(stdout.slice(0, newline));
                stdout = stdout.slice(newline + 1);
                newline = stdout.indexOf('\n');
            }
        });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
        child.on('error', (error) => finish(error));
        child.on('close', (code) => {
            if (!settled) finish(new Error(stderr.trim() || `Codex app-server exited (${code ?? 'unknown'}).`));
        });
        send({
            id: 1,
            method: 'initialize',
            params: {
                clientInfo: { name: 'ploinky-models', title: 'Ploinky Models', version: '1.0.0' },
            },
        });
    });
}

async function main() {
    process.stdout.write(JSON.stringify({ object: 'list', data: await listCodexModels() }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        process.stderr.write(`${error?.stack || error}\n`);
        process.exitCode = 1;
    });
}
