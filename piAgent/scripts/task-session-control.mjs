import {
    createLoginEventReader,
    encodeLoginResponseFrame,
} from './pi-login-protocol.mjs';

const PI_EXECUTABLE = '/home/agent/.local/bin/pi';
const SOUL_EXTENSION_PATH = '/code/extensions/ploinky-soul.mjs';
const CONTROL_EXTENSION_PATH = '/code/extensions/ploinky-control.mjs';
const LOGIN_EXTENSION_PATH = '/code/extensions/ploinky-login.mjs';
const RESPONSE_MARKER = 'PLOINKY_PI_CONTROL_RESPONSE ';
const OUTPUT_LIMIT = 256 * 1024;
const HANDLE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FLOW_RE = /^login:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTINUATION_HANDLE_RE = /^[A-Za-z0-9_-]{43}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;

function providerError(code, message, options) {
    const error = new Error(message, options);
    error.code = code;
    return error;
}

function assertOperationRuntime(providerRuntime, method = 'launch') {
    if (!providerRuntime || typeof providerRuntime !== 'object'
        || providerRuntime.provider !== 'pi'
        || providerRuntime.mode !== 'operation'
        || typeof providerRuntime[method] !== 'function') {
        throw providerError(
            'PLOINKY_PROVIDER_RUNTIME_REQUIRED',
            'PI control requires the injected PI operation provider runtime',
        );
    }
    return providerRuntime;
}

function assertOperationHandle(handle) {
    if (!handle || typeof handle !== 'object'
        || !handle.child?.stdin || !handle.child?.stdout || !handle.child?.stderr
        || !(handle.completion instanceof Promise)
        || handle.launch?.helper !== '/usr/local/libexec/ploinky-bwrap-launch'
        || handle.launch?.provider !== 'pi'
        || handle.launch?.mode !== 'operation'
        || handle.launch?.workdir !== null
        || handle.launch?.cwd !== '/workspace/operation') {
        throw providerError(
            'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID',
            'PI control did not receive the canonical private operation boundary',
        );
    }
    return handle;
}

function assertRetainedOperationController(controller) {
    if (!controller || typeof controller !== 'object'
        || !controller.stdin || !controller.stdout || !controller.stderr
        || typeof controller.stdin.write !== 'function'
        || !(controller.completion instanceof Promise)
        || controller.launch?.helper !== '/usr/local/libexec/ploinky-bwrap-launch'
        || controller.launch?.provider !== 'pi'
        || controller.launch?.mode !== 'operation'
        || controller.launch?.workdir !== null
        || controller.launch?.cwd !== '/workspace/operation') {
        throw providerError(
            'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID',
            'PI login did not receive the canonical retained operation boundary',
        );
    }
    return controller;
}

function controlInput(input) {
    const encoded = Buffer.from(JSON.stringify(input)).toString('base64url');
    if (encoded.length > 131072) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'PI control input is too large');
    }
    const secretValues = [
        input?.apiKey,
        input?.response,
    ].filter((value) => typeof value === 'string' && value.length > 0);
    return Object.freeze({ encoded, secretBearing: secretValues.length > 0 });
}

function exactPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'PI control input is invalid');
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'PI control input is invalid');
    }
    return value;
}

function exactKeys(value, allowed, required = allowed) {
    exactPlainObject(value);
    for (const key of Reflect.ownKeys(value)) {
        const descriptor = typeof key === 'string'
            ? Object.getOwnPropertyDescriptor(value, key)
            : null;
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || !allowed.has(key)) {
            throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'PI control input is invalid');
        }
    }
    for (const key of required) {
        if (!Object.hasOwn(value, key)) {
            throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'PI control input is invalid');
        }
    }
    return value;
}

function exactControlObject(payload) {
    exactPlainObject(payload);
    let input;
    if (Object.hasOwn(payload, 'input')) {
        exactKeys(
            payload,
            new Set(['input', 'metadata', 'tool']),
            new Set(['input']),
        );
        if (payload.tool !== undefined && payload.tool !== 'task-session-control') {
            throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'PI control tool is invalid');
        }
        input = exactPlainObject(payload.input);
    } else {
        input = payload;
    }
    const operation = typeof input.operation === 'string' ? input.operation : '';
    const fields = {
        login_describe: new Set(['operation', 'handle']),
        login_start: new Set(['operation', 'handle', 'provider', 'method', 'apiKey']),
        login_status: new Set(['operation', 'flowId', 'continuationHandle']),
        login_respond: new Set([
            'operation', 'flowId', 'continuationHandle', 'seq', 'nonce', 'response',
        ]),
        login_cancel: new Set(['operation', 'flowId', 'continuationHandle']),
    }[operation];
    if (!fields) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'PI login operation is invalid');
    }
    const controlOperation = ['login_status', 'login_respond', 'login_cancel'].includes(operation);
    exactKeys(
        input,
        fields,
        controlOperation
            ? new Set(['operation', 'flowId', 'continuationHandle'])
            : new Set(['operation', 'handle']),
    );
    if (!controlOperation && !HANDLE_RE.test(input.handle)) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'PI task continuation handle is invalid');
    }
    if (controlOperation
        && (!FLOW_RE.test(input.flowId)
            || !CONTINUATION_HANDLE_RE.test(input.continuationHandle))) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'PI login control is invalid');
    }
    if (operation === 'login_start') {
        if (typeof input.provider !== 'string' || !input.provider
            || input.provider !== input.provider.trim()
            || Buffer.byteLength(input.provider, 'utf8') > 256
            || !['oauth', 'api_key'].includes(input.method)
            || (input.method === 'oauth' && input.apiKey !== undefined)
            || (input.method === 'api_key'
                && (typeof input.apiKey !== 'string' || !input.apiKey
                    || input.apiKey.includes('\0')
                    || Buffer.byteLength(input.apiKey, 'utf8') > 64 * 1024))) {
            throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'PI retained login input is invalid');
        }
    }
    if (operation === 'login_respond'
        && (!Number.isSafeInteger(input.seq) || input.seq < 1
            || typeof input.nonce !== 'string' || !NONCE_RE.test(input.nonce)
            || typeof input.response !== 'string' || !input.response
            || input.response.includes('\0')
            || Buffer.byteLength(input.response, 'utf8') > 8 * 1024)) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'PI login response is invalid');
    }
    return Object.freeze({ ...input, operation });
}

function assertOperationSessions(operationSessions, methods) {
    if (!operationSessions || typeof operationSessions !== 'object'
        || methods.some((method) => typeof operationSessions[method] !== 'function')) {
        throw providerError(
            'PLOINKY_PROVIDER_LOGIN_SESSION_REQUIRED',
            'PI login control requires the trusted operation session registry',
        );
    }
    return operationSessions;
}

function loginControl(input) {
    return Object.freeze({
        flowId: input.flowId,
        continuationHandle: input.continuationHandle,
    });
}

function retainedLoginStart(input) {
    for (const name of ['handle', 'provider']) {
        if (typeof input[name] !== 'string' || !input[name]
            || input[name] !== input[name].trim()
            || input[name].includes('\0')
            || Buffer.byteLength(input[name], 'utf8') > 256) {
            throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'PI retained login input is invalid');
        }
    }
    if (input.method !== 'oauth') {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'PI retained login method is invalid');
    }
    return Object.freeze({
        handle: input.handle,
        provider: input.provider,
        method: input.method,
    });
}

function collectBounded(stream, label) {
    let output = '';
    let bytes = 0;
    stream.on('data', (chunk) => {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes <= OUTPUT_LIMIT) output += buffer.toString('utf8');
    });
    return {
        value() {
            if (bytes > OUTPUT_LIMIT) {
                throw providerError(
                    'PLOINKY_PI_CONTROL_INVALID',
                    `PI control ${label} exceeded the bounded output limit`,
                );
            }
            return output;
        },
    };
}

function parseResponse(output) {
    const line = String(output || '').split(/\r?\n/)
        .find((candidate) => candidate.startsWith(RESPONSE_MARKER));
    const encoded = line?.slice(RESPONSE_MARKER.length) || '';
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
        throw providerError('PLOINKY_PI_CONTROL_INVALID', 'PI control response is missing');
    }
    let response;
    try { response = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch (_) { }
    if (!response || typeof response !== 'object' || Array.isArray(response)
        || typeof response.ok !== 'boolean') {
        throw providerError('PLOINKY_PI_CONTROL_INVALID', 'PI control response is invalid');
    }
    return response;
}

function discardBounded(stream) {
    let bytes = 0;
    stream.on('data', (chunk) => {
        bytes = Math.min(OUTPUT_LIMIT + 1, bytes + Buffer.byteLength(chunk));
    });
    return () => bytes <= OUTPUT_LIMIT;
}

function writeResponse(controller, response) {
    const frame = encodeLoginResponseFrame(response);
    return new Promise((resolve, reject) => {
        try {
            controller.stdin.write(frame, (error) => {
                if (error) reject(providerError(
                    'provider_login_output_invalid',
                    'PI login response transport failed',
                ));
                else resolve();
            });
        } catch {
            reject(providerError(
                'provider_login_output_invalid',
                'PI login response transport failed',
            ));
        }
    });
}

async function nextRetainedState(reader, { signal, publish, validateEvent } = {}) {
    while (true) {
        const event = await reader.nextEvent({ timeoutMs: 60_000, signal });
        if (validateEvent) validateEvent(event);
        if (event.kind === 'terminal') return event;
        if (publish) publish(event.state);
        if (event.state.status === 'waiting'
            || event.state.challenge?.type === 'device_code') {
            return event;
        }
    }
}

function assertNoResponseReflection(event, response) {
    if (typeof response !== 'string' || !response) return event;
    const exposed = [
        event?.state?.challenge?.verificationUri,
        event?.state?.challenge?.userCode,
        event?.state?.prompt?.nonce,
    ].filter((value) => typeof value === 'string');
    const representations = [
        response,
        Buffer.from(response).toString('base64'),
        Buffer.from(response).toString('base64url'),
    ];
    if (exposed.some((value) => representations.some((secret) => value.includes(secret)))) {
        throw providerError(
            'provider_login_output_invalid',
            'PI login provider output reflected a response',
        );
    }
    return event;
}

function retainedTerminal(outcome, reader, stderrWithinLimit) {
    if (!stderrWithinLimit() || reader.failure) {
        return { status: 'failed', error: 'provider_login_output_invalid' };
    }
    const terminal = reader.terminal;
    if (terminal?.status === 'failed') return terminal;
    if (!outcome || outcome.code !== 0 || outcome.signal !== null) {
        return { status: 'failed', error: 'provider_login_failed' };
    }
    if (!terminal) return { status: 'failed', error: 'provider_login_output_invalid' };
    return terminal;
}

async function startRetainedLogin(input, {
    operationSessions,
    providerRuntime,
    signal,
}) {
    const selected = retainedLoginStart(input);
    const encodedStart = Buffer.from(JSON.stringify(selected)).toString('base64url');
    const controller = assertRetainedOperationController(await assertOperationRuntime(
        providerRuntime,
        'launchRetainedOperation',
    ).launchRetainedOperation({
        command: [
            PI_EXECUTABLE,
            '--print',
            '--no-session',
            '--extension',
            LOGIN_EXTENSION_PATH,
            '/ploinky-login',
            encodedStart,
        ],
    }, {
        stdio: ['pipe', 'pipe', 'pipe'],
    }));
    const stderrWithinLimit = discardBounded(controller.stderr);
    const reader = createLoginEventReader(controller.stdout);
    const first = await nextRetainedState(reader, { signal });
    if (first.kind === 'terminal') {
        let outcome;
        try { outcome = await controller.completion; } catch {
            throw providerError('provider_login_failed', 'PI retained login failed');
        }
        const terminal = retainedTerminal(outcome, reader, stderrWithinLimit);
        if (terminal.status === 'completed') {
            return {
                ok: true,
                response: {
                    type: 'login-flow',
                    version: 1,
                    status: 'completed',
                    provider: selected.provider,
                    method: selected.method,
                },
            };
        }
        throw providerError(terminal.error, 'PI retained login failed');
    }
    let currentState = first.state;
    let lastPromptSequence = first.state.prompt?.seq ?? 0;
    const sessions = assertOperationSessions(operationSessions, ['retainLoginOperation']);
    const state = await sessions.retainLoginOperation({
        controller,
        authProvider: selected.provider,
        method: selected.method,
        initialState: currentState,
        async onRespond({ seq, nonce, response, signal: responseSignal, publish }) {
            await writeResponse(controller, { seq, nonce, response });
            currentState = Object.freeze({
                status: 'running',
                ...(currentState.challenge ? { challenge: currentState.challenge } : {}),
            });
            publish(currentState);
            const next = await nextRetainedState(reader, {
                signal: responseSignal,
                validateEvent(event) {
                    assertNoResponseReflection(event, response);
                    const nextSequence = event.state.prompt?.seq;
                    if (nextSequence !== undefined) {
                        if (nextSequence <= lastPromptSequence) {
                            throw providerError(
                                'provider_login_output_invalid',
                                'PI login prompt sequence is invalid',
                            );
                        }
                        lastPromptSequence = nextSequence;
                    }
                },
                publish(candidate) { currentState = candidate; publish(candidate); },
            });
            if (next.kind === 'state') currentState = next.state;
        },
        async onCompletion({ outcome }) {
            return retainedTerminal(outcome, reader, stderrWithinLimit);
        },
    });
    return { ok: true, response: state };
}

export async function executeTaskSessionControl(payload, {
    providerRuntime,
    operationSessions,
    signal,
} = {}) {
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'PI control signal is invalid');
    }
    const input = exactControlObject(payload);
    if (input.operation === 'login_status') {
        return {
            ok: true,
            response: await assertOperationSessions(
                operationSessions,
                ['getLoginStatus'],
            ).getLoginStatus(loginControl(input)),
        };
    }
    if (input.operation === 'login_respond') {
        return {
            ok: true,
            response: await assertOperationSessions(
                operationSessions,
                ['respondToLogin'],
            ).respondToLogin(loginControl(input), {
                seq: input.seq,
                nonce: input.nonce,
                response: input.response,
            }),
        };
    }
    if (input.operation === 'login_cancel') {
        return {
            ok: true,
            response: await assertOperationSessions(
                operationSessions,
                ['cancelLogin'],
            ).cancelLogin(loginControl(input)),
        };
    }
    if (input.operation === 'login_start' && input.method === 'oauth') {
        return startRetainedLogin(input, { operationSessions, providerRuntime, signal });
    }
    const { encoded, secretBearing } = controlInput(input);
    const runtime = assertOperationHandle(await assertOperationRuntime(providerRuntime).launch({
        command: [
            PI_EXECUTABLE,
            '--print',
            '--no-session',
            '--extension',
            SOUL_EXTENSION_PATH,
            '--extension',
            CONTROL_EXTENSION_PATH,
        ],
    }, {
        stdio: ['pipe', 'pipe', 'pipe'],
    }));
    const stdout = collectBounded(runtime.child.stdout, 'stdout');
    const stderr = collectBounded(runtime.child.stderr, 'stderr');
    runtime.child.stdin.end(`/ploinky-control ${encoded}\n`);
    const result = await runtime.completion;
    const stdoutText = stdout.value();
    const stderrText = stderr.value();
    if (result?.code !== 0 || result?.signal) {
        throw providerError(
            'PLOINKY_PI_CONTROL_FAILED',
            (secretBearing ? '' : stderrText.trim())
                || `PI control failed (${result?.signal || result?.code || 'unknown'}).`,
        );
    }
    return parseResponse(stdoutText);
}

export const __testables = Object.freeze({
    CONTROL_EXTENSION_PATH,
    LOGIN_EXTENSION_PATH,
    OUTPUT_LIMIT,
    PI_EXECUTABLE,
    RESPONSE_MARKER,
    SOUL_EXTENSION_PATH,
    assertOperationHandle,
    assertRetainedOperationController,
    assertNoResponseReflection,
    nextRetainedState,
    parseResponse,
    retainedTerminal,
    startRetainedLogin,
});
