#!/usr/bin/env node

import {
    updateLoginFlow,
    waitForLoginResponse,
} from './login-flow-store.mjs';
import { authorizationChallenge } from './login-methods.mjs';
import { openCodeJson, startOpenCodeControlServer } from './opencode-control-server.mjs';

const [flowId, provider, methodIndexRaw, declaredKind, inputsRaw = ''] = process.argv.slice(2);
const methodIndex = Number.parseInt(methodIndexRaw, 10);
let inputs = {};
try { inputs = JSON.parse(Buffer.from(inputsRaw, 'base64url').toString('utf8')); } catch (_) { }
let server = null;
const cancellation = new AbortController();
process.on('SIGTERM', () => {
    cancellation.abort();
    void server?.close();
});

async function main() {
    server = await startOpenCodeControlServer();
    const authorization = await openCodeJson(server, `/provider/${encodeURIComponent(provider)}/oauth/authorize`, {
        method: 'POST',
        body: JSON.stringify({ method: methodIndex, inputs }),
    });
    updateLoginFlow(flowId, {
        status: authorization.method === 'code' ? 'waiting' : 'running',
        challenge: authorizationChallenge(authorization, declaredKind),
        ...(authorization.method === 'code' ? {
            prompt: { type: 'manual_code', message: authorization.instructions || 'Paste the authorization code.' },
        } : {}),
    });
    if (authorization.method === 'code') {
        const code = await waitForLoginResponse(flowId, { signal: cancellation.signal });
        await openCodeJson(server, `/provider/${encodeURIComponent(provider)}/oauth/callback`, {
            method: 'POST',
            body: JSON.stringify({ method: methodIndex, code }),
        });
    } else {
        const deadline = Date.now() + 15 * 60 * 1000;
        let connected = false;
        while (Date.now() < deadline && !cancellation.signal.aborted) {
            const status = await openCodeJson(server, '/provider');
            if (Array.isArray(status?.connected) && status.connected.includes(provider)) {
                connected = true;
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (cancellation.signal.aborted) throw new Error('login_cancelled');
        if (!connected) throw new Error('provider_login_timed_out');
    }
    updateLoginFlow(flowId, { status: 'completed', prompt: null, challenge: null });
}

main().catch((error) => {
    updateLoginFlow(flowId, {
        status: cancellation.signal.aborted ? 'cancelled' : 'failed',
        error: cancellation.signal.aborted ? '' : String(error?.message || error).slice(0, 500),
        prompt: null,
    });
}).finally(() => server?.close());
