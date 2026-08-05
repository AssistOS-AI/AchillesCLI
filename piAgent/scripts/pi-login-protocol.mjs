import { StringDecoder } from 'node:string_decoder';

export const LOGIN_EVENT_MARKER = 'PLOINKY_PI_LOGIN_EVENT ';
export const LOGIN_RESPONSE_MARKER = 'PLOINKY_PI_LOGIN_RESPONSE ';
const MAX_FRAME_BYTES = 64 * 1024;
const MAX_LINE_BYTES = MAX_FRAME_BYTES + 256;
const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const FRAME_RE = /^[A-Za-z0-9_-]+$/;
const TERMINAL_ERRORS = new Set([
    'provider_login_failed',
    'provider_login_output_invalid',
]);

function protocolError() {
    const error = new Error('PI login protocol output is invalid');
    error.code = 'provider_login_output_invalid';
    return error;
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(value, allowed, required = allowed) {
    if (!isPlainObject(value)) throw protocolError();
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw protocolError();
    }
    for (const key of required) {
        if (!Object.hasOwn(value, key)) throw protocolError();
    }
}

function validateChallenge(challenge) {
    assertExactKeys(
        challenge,
        new Set(['type', 'verificationUri', 'userCode']),
        new Set(['type', 'verificationUri']),
    );
    let verificationUrl;
    try { verificationUrl = new URL(challenge.verificationUri); } catch (_) { }
    if (!['authorization_url', 'device_code'].includes(challenge.type)
        || typeof challenge.verificationUri !== 'string'
        || challenge.verificationUri !== challenge.verificationUri.trim()
        || Buffer.byteLength(challenge.verificationUri, 'utf8') > 4096
        || verificationUrl?.protocol !== 'https:'
        || !verificationUrl.hostname
        || verificationUrl.username
        || verificationUrl.password
        || (challenge.type === 'device_code'
            && (typeof challenge.userCode !== 'string'
                || !/^[A-Za-z0-9-]{4,64}$/.test(challenge.userCode)))
        || (challenge.type === 'authorization_url' && challenge.userCode !== undefined)) {
        throw protocolError();
    }
    return Object.freeze({ ...challenge });
}

function validatePrompt(prompt) {
    assertExactKeys(prompt, new Set(['type', 'seq', 'nonce']));
    if (!['manual_code', 'manual_callback'].includes(prompt.type)
        || !Number.isSafeInteger(prompt.seq) || prompt.seq < 1
        || typeof prompt.nonce !== 'string' || !NONCE_RE.test(prompt.nonce)) {
        throw protocolError();
    }
    return Object.freeze({ ...prompt });
}

function validateState(state, { terminal }) {
    assertExactKeys(
        state,
        new Set(['status', 'challenge', 'prompt', 'error']),
        new Set(['status']),
    );
    if (terminal) {
        if (!['completed', 'failed'].includes(state.status)
            || state.challenge !== undefined || state.prompt !== undefined
            || (state.status === 'completed' && state.error !== undefined)
            || (state.status === 'failed' && !TERMINAL_ERRORS.has(state.error))) {
            throw protocolError();
        }
        return Object.freeze({
            status: state.status,
            ...(state.error ? { error: state.error } : {}),
        });
    }
    if (!['running', 'waiting'].includes(state.status)
        || state.error !== undefined
        || (state.status === 'waiting' && state.prompt === undefined)
        || (state.status === 'running' && state.prompt !== undefined)) {
        throw protocolError();
    }
    return Object.freeze({
        status: state.status,
        ...(state.challenge ? { challenge: validateChallenge(state.challenge) } : {}),
        ...(state.prompt ? { prompt: validatePrompt(state.prompt) } : {}),
    });
}

function validateEvent(value) {
    assertExactKeys(value, new Set(['kind', 'state']));
    if (value.kind !== 'state' && value.kind !== 'terminal') throw protocolError();
    return Object.freeze({
        kind: value.kind,
        state: validateState(value.state, { terminal: value.kind === 'terminal' }),
    });
}

function validateResponse(value) {
    assertExactKeys(value, new Set(['seq', 'nonce', 'response']));
    if (!Number.isSafeInteger(value.seq) || value.seq < 1
        || typeof value.nonce !== 'string' || !NONCE_RE.test(value.nonce)
        || typeof value.response !== 'string' || value.response.includes('\0')
        || Buffer.byteLength(value.response, 'utf8') < 1
        || Buffer.byteLength(value.response, 'utf8') > 8 * 1024) {
        throw protocolError();
    }
    return Object.freeze({ ...value });
}

function encodeFrame(marker, value, validator) {
    const normalized = validator(value);
    const encoded = Buffer.from(JSON.stringify(normalized)).toString('base64url');
    if (Buffer.byteLength(encoded, 'ascii') > MAX_FRAME_BYTES) throw protocolError();
    return Buffer.from(`${marker}${encoded}\n`);
}

function decodeFrame(line, marker, validator) {
    if (!line.startsWith(marker)) return null;
    const encoded = line.slice(marker.length);
    if (!encoded || Buffer.byteLength(encoded, 'ascii') > MAX_FRAME_BYTES
        || !FRAME_RE.test(encoded)) {
        throw protocolError();
    }
    let parsed;
    try {
        const bytes = Buffer.from(encoded, 'base64url');
        if (bytes.toString('base64url') !== encoded) throw protocolError();
        parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
        throw protocolError();
    }
    return validator(parsed);
}

function consumeLines(stream, onLine, onEnd, onFailure) {
    if (!stream || typeof stream.on !== 'function') throw protocolError();
    const decoder = new StringDecoder('utf8');
    let buffered = '';
    let closed = false;
    const fail = () => {
        if (closed) return;
        closed = true;
        onFailure(protocolError());
    };
    stream.on('data', (chunk) => {
        if (closed) return;
        buffered += decoder.write(Buffer.from(chunk));
        if (Buffer.byteLength(buffered, 'utf8') > MAX_LINE_BYTES && !buffered.includes('\n')) {
            fail();
            return;
        }
        let newline = buffered.indexOf('\n');
        while (!closed && newline !== -1) {
            const line = buffered.slice(0, newline).replace(/\r$/, '');
            buffered = buffered.slice(newline + 1);
            if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
                fail();
                return;
            }
            try { onLine(line); } catch (_) { fail(); }
            newline = buffered.indexOf('\n');
        }
    });
    stream.once('error', fail);
    stream.once('end', () => {
        if (closed) return;
        buffered += decoder.end();
        if (buffered) {
            if (Buffer.byteLength(buffered, 'utf8') > MAX_LINE_BYTES) return fail();
            try { onLine(buffered.replace(/\r$/, '')); } catch (_) { return fail(); }
        }
        closed = true;
        onEnd();
    });
    return Object.freeze({ fail });
}

export function encodeLoginEventFrame(event) {
    return encodeFrame(LOGIN_EVENT_MARKER, event, validateEvent);
}

export function encodeLoginResponseFrame(response) {
    return encodeFrame(LOGIN_RESPONSE_MARKER, response, validateResponse);
}

export function createLoginEventReader(stream) {
    const queue = [];
    let waiter = null;
    let failure = null;
    let ended = false;
    let terminal = null;

    const rejectWaiter = (error) => {
        const pending = waiter;
        waiter = null;
        pending?.cleanup();
        pending?.reject(error);
    };
    const fail = (error = protocolError()) => {
        if (failure) return;
        failure = error?.code === 'provider_login_output_invalid' ? error : protocolError();
        queue.length = 0;
        rejectWaiter(failure);
    };
    const deliver = (event) => {
        if (failure) return;
        if (terminal || (event.kind === 'terminal' && terminal)) return fail();
        if (event.kind === 'terminal') terminal = event.state;
        if (waiter) {
            const pending = waiter;
            waiter = null;
            pending.cleanup();
            pending.resolve(event);
        } else {
            queue.push(event);
        }
    };
    consumeLines(stream, (line) => {
        const event = decodeFrame(line, LOGIN_EVENT_MARKER, validateEvent);
        if (event) deliver(event);
    }, () => {
        ended = true;
        if (waiter && queue.length === 0) rejectWaiter(protocolError());
    }, fail);

    return Object.freeze({
        get failure() { return failure; },
        get terminal() { return terminal; },
        nextEvent({ timeoutMs = 15_000, signal } = {}) {
            if (failure) return Promise.reject(failure);
            if (queue.length) return Promise.resolve(queue.shift());
            if (ended || waiter || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
                return Promise.reject(protocolError());
            }
            return new Promise((resolve, reject) => {
                let timer;
                const abort = () => {
                    if (waiter?.reject !== reject) return;
                    waiter = null;
                    cleanup();
                    reject(protocolError());
                };
                const cleanup = () => {
                    if (timer) clearTimeout(timer);
                    signal?.removeEventListener?.('abort', abort);
                };
                timer = setTimeout(abort, timeoutMs);
                signal?.addEventListener?.('abort', abort, { once: true });
                waiter = { cleanup, reject, resolve };
                if (signal?.aborted) abort();
            });
        },
    });
}

export function createLoginResponseReader(stream, { onFailure } = {}) {
    if (onFailure !== undefined && typeof onFailure !== 'function') throw protocolError();
    let pending = null;
    let failure = null;
    let ended = false;
    const fail = (error = protocolError()) => {
        if (failure) return;
        failure = error?.code === 'provider_login_output_invalid' ? error : protocolError();
        onFailure?.(failure);
        if (pending) {
            const current = pending;
            pending = null;
            current.cleanup();
            current.reject(failure);
        }
    };
    consumeLines(stream, (line) => {
        const response = decodeFrame(line, LOGIN_RESPONSE_MARKER, validateResponse);
        if (!response || !pending
            || response.seq !== pending.binding.seq
            || response.nonce !== pending.binding.nonce) {
            throw protocolError();
        }
        const current = pending;
        pending = null;
        current.cleanup();
        current.resolve(response.response);
    }, () => {
        ended = true;
        if (pending) fail();
    }, fail);

    return Object.freeze({
        get failure() { return failure; },
        waitForResponse(binding, { signal } = {}) {
            let normalized;
            try { normalized = validatePrompt(binding); } catch (error) {
                return Promise.reject(error);
            }
            if (failure || ended || pending) return Promise.reject(failure || protocolError());
            return new Promise((resolve, reject) => {
                const abort = () => fail();
                const cleanup = () => signal?.removeEventListener?.('abort', abort);
                pending = { binding: normalized, cleanup, reject, resolve };
                signal?.addEventListener?.('abort', abort, { once: true });
                if (signal?.aborted) abort();
            });
        },
    });
}

export const __testables = Object.freeze({
    MAX_FRAME_BYTES,
    MAX_LINE_BYTES,
    protocolError,
    validateEvent,
    validateResponse,
});
