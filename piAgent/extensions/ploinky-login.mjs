import { randomBytes } from 'node:crypto';

import {
    createLoginResponseReader,
    encodeLoginEventFrame,
} from '../scripts/pi-login-protocol.mjs';

const MODEL_RUNTIME_MODULE = '/home/agent/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
const CONTINUATION_STORE_MODULE = '/code/scripts/continuation-store.mjs';

function loginFailure(code = 'provider_login_failed') {
    const error = new Error(code);
    error.code = code;
    return error;
}

function assertLoginInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw loginFailure();
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) throw loginFailure();
    const allowed = new Set(['handle', 'provider', 'method']);
    for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== 'string' || !allowed.has(key)) throw loginFailure();
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw loginFailure();
    }
    for (const key of allowed) {
        if (typeof input[key] !== 'string' || !input[key]
            || input[key] !== input[key].trim()
            || input[key].includes('\0')
            || Buffer.byteLength(input[key], 'utf8') > 256) {
            throw loginFailure();
        }
    }
    if (input.method !== 'oauth') throw loginFailure();
    return Object.freeze({
        handle: input.handle,
        provider: input.provider,
        method: input.method,
    });
}

function normalizeChallenge(event) {
    if (event?.type === 'device_code') {
        return Object.freeze({
            type: 'device_code',
            verificationUri: String(event.verificationUri || ''),
            userCode: String(event.userCode || ''),
        });
    }
    if (event?.type === 'auth_url') {
        return Object.freeze({
            type: 'authorization_url',
            verificationUri: String(event.url || ''),
        });
    }
    throw loginFailure('provider_login_output_invalid');
}

function selectHeadlessOption(prompt) {
    const options = Array.isArray(prompt?.options) ? prompt.options : [];
    const supported = options.filter((option) => {
        const text = `${String(option?.id || '')} ${String(option?.label || '')}`;
        return /device|code|headless|remote|manual|callback/i.test(text);
    });
    if (supported.length !== 1 || typeof supported[0]?.id !== 'string'
        || !supported[0].id || supported[0].id.includes('\0')) {
        throw loginFailure('provider_login_output_invalid');
    }
    return supported[0].id;
}

function manualPromptType(prompt) {
    if (!['text', 'secret'].includes(String(prompt?.type || ''))) {
        throw loginFailure('provider_login_output_invalid');
    }
    const description = `${String(prompt?.message || '')} ${String(prompt?.placeholder || '')}`;
    return /callback|https?:\/\//i.test(description) ? 'manual_callback' : 'manual_code';
}

async function createModelRuntime() {
    const module = await import(MODEL_RUNTIME_MODULE);
    if (typeof module?.ModelRuntime?.create !== 'function') throw loginFailure();
    return module.ModelRuntime.create({ allowModelNetwork: false });
}

async function readContinuationRecord(handle) {
    const module = await import(CONTINUATION_STORE_MODULE);
    if (typeof module?.readContinuationRecord !== 'function') throw loginFailure();
    return module.readContinuationRecord(handle);
}

function createNonce() {
    return randomBytes(18).toString('base64url');
}

const productionDependencies = Object.freeze({
    createModelRuntime,
    createNonce,
    readContinuationRecord,
});

export async function executeRetainedLogin(rawInput, dependencies = {}) {
    const input = assertLoginInput(rawInput);
    const createRuntime = dependencies.createModelRuntime ?? productionDependencies.createModelRuntime;
    const readRecord = dependencies.readContinuationRecord ?? productionDependencies.readContinuationRecord;
    const nextNonce = dependencies.createNonce ?? productionDependencies.createNonce;
    const emitState = dependencies.emitState;
    const waitForResponse = dependencies.waitForResponse;
    const signal = dependencies.signal;
    if (typeof createRuntime !== 'function' || typeof readRecord !== 'function'
        || typeof nextNonce !== 'function' || typeof emitState !== 'function'
        || typeof waitForResponse !== 'function'
        || (signal !== undefined && !(signal instanceof AbortSignal))) {
        throw loginFailure('provider_login_output_invalid');
    }

    try {
        await readRecord(input.handle);
        const runtime = await createRuntime();
        if (!runtime || typeof runtime.login !== 'function') throw loginFailure();
        let challenge = null;
        let sequence = 0;
        await runtime.login(input.provider, input.method, {
            signal,
            notify(event) {
                challenge = normalizeChallenge(event);
                if (challenge.type === 'device_code') {
                    emitState(Object.freeze({ status: 'running', challenge }));
                }
            },
            async prompt(prompt) {
                if (prompt?.type === 'select') return selectHeadlessOption(prompt);
                sequence += 1;
                const binding = Object.freeze({
                    type: manualPromptType(prompt),
                    seq: sequence,
                    nonce: nextNonce(),
                });
                emitState(Object.freeze({
                    status: 'waiting',
                    ...(challenge ? { challenge } : {}),
                    prompt: binding,
                }));
                return waitForResponse(binding, { signal });
            },
        });
        return Object.freeze({ status: 'completed' });
    } catch (error) {
        return Object.freeze({
            status: 'failed',
            error: error?.code === 'provider_login_output_invalid'
                ? 'provider_login_output_invalid'
                : 'provider_login_failed',
        });
    }
}

function decodeStartInput(value) {
    const encoded = String(value || '').trim();
    if (!/^[A-Za-z0-9_-]{1,4096}$/.test(encoded)) throw loginFailure();
    try {
        const bytes = Buffer.from(encoded, 'base64url');
        if (bytes.toString('base64url') !== encoded) throw loginFailure();
        return assertLoginInput(JSON.parse(bytes.toString('utf8')));
    } catch {
        throw loginFailure();
    }
}

export default function registerPloinkyLogin(pi) {
    pi.registerCommand('ploinky-login', {
        description: 'Run one retained trusted Ploinky PI login flow.',
        async handler(args) {
            const abortController = new AbortController();
            const responses = createLoginResponseReader(process.stdin, {
                onFailure() { abortController.abort(); },
            });
            let terminal;
            try {
                terminal = await executeRetainedLogin(decodeStartInput(args), {
                    signal: abortController.signal,
                    emitState(state) {
                        process.stdout.write(encodeLoginEventFrame({ kind: 'state', state }));
                    },
                    waitForResponse(binding, options) {
                        return responses.waitForResponse(binding, options);
                    },
                });
            } catch {
                terminal = { status: 'failed', error: 'provider_login_failed' };
            }
            process.stdout.write(encodeLoginEventFrame({ kind: 'terminal', state: terminal }));
            if (terminal.status !== 'completed') process.exitCode = 1;
        },
    });
}

export const __testables = Object.freeze({
    CONTINUATION_STORE_MODULE,
    MODEL_RUNTIME_MODULE,
    assertLoginInput,
    decodeStartInput,
    manualPromptType,
    normalizeChallenge,
    selectHeadlessOption,
});
