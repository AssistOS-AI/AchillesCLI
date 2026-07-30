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
    const options = Array.isArray(prompt?.options)
        ? prompt.options.map((option) => ({
            id: String(option.id),
            label: String(option.label),
            description: String(option.description || ''),
        })).filter((option) => (
            !/browser/i.test(option.label)
            || /device\s*code|headless|remote/i.test(option.label)
        ))
        : [];
    return {
        type: String(prompt?.type || 'text'),
        message: String(prompt?.message || 'Authentication input required.'),
        placeholder: String(prompt?.placeholder || ''),
        options,
    };
}

function publicEvent(event) {
    if (!event || typeof event !== 'object') return null;
    if (event.type === 'auth_url') {
        return {
            type: 'manual_oauth_code',
            url: event.url,
            instructions: event.instructions || '',
        };
    }
    if (event.type === 'device_code') {
        return {
            type: 'device_code',
            userCode: event.userCode,
            verificationUri: event.verificationUri,
            intervalSeconds: event.intervalSeconds,
            expiresInSeconds: event.expiresInSeconds,
        };
    }
    return null;
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
            const nextPrompt = publicPrompt(prompt);
            if (prompt?.type === 'select' && Array.isArray(prompt.options)) {
                if (!nextPrompt.options.length) throw new Error('unsupported_container_login_flow');
                if (nextPrompt.options.length === 1) return nextPrompt.options[0].id;
            }
            updateLoginFlow(flowId, { status: 'waiting', prompt: nextPrompt });
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
