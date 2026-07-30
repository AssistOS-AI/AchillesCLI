#!/usr/bin/env node

import {
    updateLoginFlow,
    waitForLoginResponse,
} from './login-flow-store.mjs';
import { createPiModelRuntime } from './pi-model-runtime.mjs';

const [flowId, provider, method] = process.argv.slice(2);
const cancellation = new AbortController();
process.on('SIGTERM', () => cancellation.abort());

function publicPrompt(prompt) {
    return {
        type: String(prompt?.type || 'text'),
        message: String(prompt?.message || 'Authentication input required.'),
        placeholder: String(prompt?.placeholder || ''),
        options: Array.isArray(prompt?.options)
            ? prompt.options.map((option) => ({ id: String(option.id), label: String(option.label), description: String(option.description || '') }))
            : [],
    };
}

function publicEvent(event) {
    if (!event || typeof event !== 'object') return null;
    if (event.type === 'auth_url') return { type: 'auth_url', url: event.url, instructions: event.instructions || '' };
    if (event.type === 'device_code') {
        return {
            type: 'device_code',
            userCode: event.userCode,
            verificationUri: event.verificationUri,
            intervalSeconds: event.intervalSeconds,
            expiresInSeconds: event.expiresInSeconds,
        };
    }
    return { type: event.type || 'info', message: String(event.message || '') };
}

async function main() {
    const runtime = await createPiModelRuntime();
    await runtime.login(provider, method, {
        signal: cancellation.signal,
        notify(event) {
            const challenge = publicEvent(event);
            if (challenge) updateLoginFlow(flowId, { status: 'running', challenge });
        },
        async prompt(prompt) {
            updateLoginFlow(flowId, { status: 'waiting', prompt: publicPrompt(prompt) });
            return waitForLoginResponse(flowId, { signal: cancellation.signal });
        },
    });
    updateLoginFlow(flowId, { status: 'completed', prompt: null, challenge: null });
}

main().catch((error) => {
    updateLoginFlow(flowId, {
        status: cancellation.signal.aborted ? 'cancelled' : 'failed',
        error: cancellation.signal.aborted ? '' : String(error?.message || 'Login failed.').slice(0, 500),
        prompt: null,
    });
});
