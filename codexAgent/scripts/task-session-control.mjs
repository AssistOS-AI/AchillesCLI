import {
    selectContinuationRecordFromHome,
} from './continuation-store.mjs';
import {
    parseCodexDeviceLoginOutput,
} from './codex-login-output.mjs';
import {
    createCodexLoginOperationSessions,
} from './login-operation-sessions.mjs';

const CODEX_EXECUTABLE = '/home/agent/.local/bin/codex';
const DEVICE_VERIFICATION_URL = 'https://auth.openai.com/codex/device';
const OUTPUT_LIMIT = 16 * 1024;
const CHALLENGE_TIMEOUT_MS = 30_000;
const HANDLE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FLOW_RE = /^login:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTINUATION_HANDLE_RE = /^[A-Za-z0-9_-]{43}$/;

const PROVIDERS = Object.freeze([Object.freeze({
    key: 'openai',
    label: 'OpenAI / ChatGPT',
    methods: Object.freeze([
        Object.freeze({ key: 'api_key', kind: 'api_key', label: 'OpenAI API key', secret: true }),
        Object.freeze({ key: 'access_token', kind: 'access_token', label: 'Codex access token', secret: true }),
        Object.freeze({ key: 'device_code', kind: 'device_code', label: 'Browser (device code)' }),
    ]),
})]);

function providerError(code, message, options) {
    const error = new Error(message, options);
    error.code = code;
    return error;
}

function exactPlainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', `${label} must be an object.`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', `${label} must be a plain object.`);
    }
    return value;
}

function exactKeys(value, allowed, required, label) {
    exactPlainObject(value, label);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', `${label} contains unsupported field ${key}.`);
        }
    }
    for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
            throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', `${label} is missing ${key}.`);
        }
    }
    return value;
}

function inputFromPayload(payload) {
    exactPlainObject(payload, 'Codex control payload');
    let input;
    if (Object.prototype.hasOwnProperty.call(payload, 'input')) {
        exactKeys(
            payload,
            new Set(['input', 'metadata', 'tool']),
            new Set(['input']),
            'Codex control payload',
        );
        if (payload.tool !== undefined && payload.tool !== 'task-session-control') {
            throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'Codex control tool is invalid.');
        }
        input = exactPlainObject(payload.input, 'Codex control input');
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
    if (!fields) throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'Codex login operation is unsupported.');
    const controlOperation = ['login_status', 'login_respond', 'login_cancel'].includes(operation);
    exactKeys(
        input,
        fields,
        controlOperation
            ? new Set(['operation', 'flowId', 'continuationHandle'])
            : new Set(['operation', 'handle']),
        'Codex control input',
    );
    if (!controlOperation && (typeof input.handle !== 'string' || !HANDLE_RE.test(input.handle))) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'Codex task continuation handle is invalid.');
    }
    if (controlOperation
        && (typeof input.flowId !== 'string' || !FLOW_RE.test(input.flowId))) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'Codex login flow is invalid.');
    }
    if (controlOperation
        && (typeof input.continuationHandle !== 'string'
            || !CONTINUATION_HANDLE_RE.test(input.continuationHandle))) {
        throw providerError(
            'PLOINKY_PROVIDER_INPUT_INVALID',
            'Codex login continuation handle is invalid.',
        );
    }
    if (operation === 'login_respond'
        && (!Number.isSafeInteger(input.seq) || input.seq < 1
            || typeof input.nonce !== 'string'
            || !/^[A-Za-z0-9_-]{16,128}$/u.test(input.nonce)
            || typeof input.response !== 'string' || !input.response
            || input.response.includes('\0')
            || Buffer.byteLength(input.response, 'utf8') > 8 * 1024)) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'Codex login response is invalid.');
    }
    return Object.freeze({ ...input, operation });
}

function assertOperationRuntime(providerRuntime) {
    if (!providerRuntime || typeof providerRuntime !== 'object'
        || providerRuntime.provider !== 'codex'
        || providerRuntime.mode !== 'operation'
        || typeof providerRuntime.resolveHomeState !== 'function'
        || typeof providerRuntime.continueOperation !== 'function'
        || typeof providerRuntime.launch !== 'function'
        || typeof providerRuntime.launchRetainedOperation !== 'function') {
        throw providerError(
            'PLOINKY_PROVIDER_RUNTIME_REQUIRED',
            'Codex login requires the admitted operation provider runtime.',
        );
    }
    return providerRuntime;
}

function assertLaunch(launch) {
    if (!launch || typeof launch !== 'object'
        || launch.helper !== '/usr/local/libexec/ploinky-bwrap-launch'
        || launch.provider !== 'codex'
        || launch.mode !== 'operation'
        || launch.workdir !== null
        || launch.cwd !== '/workspace/operation') {
        throw providerError(
            'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID',
            'Codex login did not receive the canonical private operation boundary.',
        );
    }
    return launch;
}

function assertOperationHandle(handle) {
    if (!handle || typeof handle !== 'object'
        || !handle.child || typeof handle.child !== 'object'
        || !(handle.completion instanceof Promise)) {
        throw providerError(
            'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID',
            'Codex login received an invalid operation handle.',
        );
    }
    assertLaunch(handle.launch);
    return handle;
}

function assertRetainedController(controller) {
    if (!controller || typeof controller !== 'object'
        || !Object.prototype.hasOwnProperty.call(controller, 'stdin')
        || !controller.stdout || !controller.stderr
        || !(controller.completion instanceof Promise)
        || controller.child !== undefined || controller.pid !== undefined || controller.kill !== undefined) {
        throw providerError(
            'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID',
            'Codex device login received an invalid retained controller.',
        );
    }
    assertLaunch(controller.launch);
    return controller;
}

function recordSnapshot(record) {
    return JSON.stringify({
        handle: record.handle,
        threadId: record.threadId,
        projectDir: record.projectDir,
    });
}

function assertSelectedRecord(record, handle) {
    if (!record || typeof record !== 'object'
        || record.handle !== handle
        || typeof record.threadId !== 'string' || !record.threadId
        || typeof record.projectDir !== 'string' || !record.projectDir.startsWith('/workspace/')) {
        throw providerError(
            'PLOINKY_PROVIDER_CONTINUATION_INVALID',
            'Codex login received invalid trusted continuation state.',
        );
    }
    return record;
}

async function selectContinuation(runtime, continuationStore, handle) {
    let boundary;
    const record = assertSelectedRecord(await runtime.resolveHomeState((context) => {
        const validRuntimeHome = context.runtimeKind === 'bwrap'
            ? context.homePath === '/home/agent'
            : context.runtimeKind === 'container'
                && context.homePath === '/root';
        if (context.provider !== 'codex' || !validRuntimeHome) {
            throw providerError(
                'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID',
                'Codex login received the wrong runtime HOME boundary.',
            );
        }
        boundary = Object.freeze({ ...context });
        return continuationStore.selectContinuationRecordFromHome(context.homePath, handle);
    }), handle);
    if (!boundary || runtime.continueOperation() !== 'operation') {
        throw providerError(
            'PLOINKY_PROVIDER_RUNTIME_TRANSITION_INVALID',
            'Codex login could not enter the canonical operation runtime.',
        );
    }
    const snapshot = recordSnapshot(record);
    return Object.freeze({
        validateAfterLease(context) {
            if (context.provider !== 'codex'
                || context.homePath !== boundary.homePath
                || context.runtimeKind !== boundary.runtimeKind
                || context.mode !== 'operation'
                || context.workdir !== null) {
                throw providerError(
                    'PLOINKY_PROVIDER_CONTINUATION_CHANGED',
                    'Codex login runtime identity changed before launch.',
                );
            }
            let current;
            try {
                current = continuationStore.selectContinuationRecordFromHome(context.homePath, handle);
            } catch (cause) {
                throw providerError(
                    'PLOINKY_PROVIDER_CONTINUATION_CHANGED',
                    'Codex login continuation state could not be revalidated.',
                    { cause },
                );
            }
            if (recordSnapshot(current) !== snapshot) {
                throw providerError(
                    'PLOINKY_PROVIDER_CONTINUATION_CHANGED',
                    'Codex login continuation state changed before launch.',
                );
            }
        },
    });
}

function outputCollector(stdout, stderr) {
    let output = '';
    let bytes = 0;
    let exceeded = false;
    const listeners = new Set();
    const append = (chunk) => {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > OUTPUT_LIMIT) {
            exceeded = true;
            output = '';
        } else if (!exceeded) {
            output += buffer.toString('utf8');
        }
        for (const listener of listeners) listener();
    };
    stdout?.on?.('data', append);
    stderr?.on?.('data', append);
    return Object.freeze({
        get exceeded() { return exceeded; },
        get output() { return output; },
        onChange(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    });
}

function challengeState(parsed) {
    return Object.freeze({
        status: 'running',
        challenge: Object.freeze({
            type: 'device_code',
            verificationUri: DEVICE_VERIFICATION_URL,
            userCode: parsed.code,
        }),
    });
}

function waitForDeviceChallenge(controller, timeoutMs) {
    const collector = outputCollector(controller.stdout, controller.stderr);
    const challenge = new Promise((resolve, reject) => {
        let settled = false;
        let unsubscribe = () => {};
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            unsubscribe();
            if (error) reject(error);
            else resolve(value);
        };
        const inspect = () => {
            if (collector.exceeded) {
                finish(providerError('PLOINKY_CODEX_LOGIN_FAILED', 'Codex device login output was invalid.'));
                return;
            }
            const parsed = parseCodexDeviceLoginOutput(collector.output);
            if (parsed.url === DEVICE_VERIFICATION_URL && parsed.code) {
                finish(null, challengeState(parsed));
            }
        };
        const timer = setTimeout(() => finish(providerError(
            'PLOINKY_CODEX_LOGIN_FAILED',
            'Codex device login did not produce a challenge.',
        )), timeoutMs);
        timer.unref?.();
        unsubscribe = collector.onChange(inspect);
        controller.completion.then(() => {
            finish(providerError(
                'PLOINKY_CODEX_LOGIN_FAILED',
                'Codex device login exited before producing a challenge.',
            ));
        }, () => {
            finish(providerError(
                'PLOINKY_CODEX_LOGIN_FAILED',
                'Codex device login failed before producing a challenge.',
            ));
        });
        inspect();
    });
    return Object.freeze({ challenge, collector });
}

async function runOneShotLogin(runtime, selected, method, secret) {
    if (typeof secret !== 'string' || !secret || secret.includes('\0')
        || Buffer.byteLength(secret, 'utf8') > 8 * 1024) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'Codex login secret is invalid.');
    }
    const flag = method === 'api_key' ? '--with-api-key' : '--with-access-token';
    const handle = assertOperationHandle(await runtime.launch({
        command: [CODEX_EXECUTABLE, 'login', flag],
    }, {
        stdio: ['pipe', 'ignore', 'pipe'],
        validateAfterLease: selected.validateAfterLease,
    }));
    if (!handle.child.stdin || !handle.child.stderr) {
        throw providerError(
            'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID',
            'Codex credential login did not receive its canonical pipe boundary.',
        );
    }
    const collector = outputCollector(handle.child.stdout, handle.child.stderr);
    handle.child.stdin.end(`${secret}\n`);
    let outcome;
    try { outcome = await handle.completion; } catch (_) { }
    if (collector.exceeded || outcome?.code !== 0 || outcome?.signal) {
        throw providerError('PLOINKY_CODEX_LOGIN_FAILED', 'Codex credential login failed.');
    }
    return {
        type: 'login-flow',
        version: 1,
        status: 'completed',
        provider: 'openai',
        method,
    };
}

async function describeLogin(runtime, selected) {
    const handle = assertOperationHandle(await runtime.launch({
        command: [CODEX_EXECUTABLE, 'login', '--help'],
    }, {
        stdio: ['ignore', 'ignore', 'ignore'],
        validateAfterLease: selected.validateAfterLease,
    }));
    let outcome;
    try { outcome = await handle.completion; } catch (_) { }
    if (outcome?.code !== 0 || outcome?.signal) {
        throw providerError('PLOINKY_CODEX_LOGIN_FAILED', 'Codex login catalog probe failed.');
    }
    return { type: 'login-catalog', version: 1, providers: PROVIDERS };
}

async function executeTaskSessionControlWithDependencies(payload, context, dependencies) {
    const input = inputFromPayload(payload);
    let operationSessions;
    const requireOperationSessions = () => {
        operationSessions ??= dependencies.operationSessions
            ?? dependencies.createOperationSessions(context?.operationSessions);
        return operationSessions;
    };
    if (input.operation === 'login_status') {
        return {
            ok: true,
            response: await requireOperationSessions().getStatus({
                flowId: input.flowId,
                continuationHandle: input.continuationHandle,
            }),
        };
    }
    if (input.operation === 'login_respond') {
        return {
            ok: true,
            response: await requireOperationSessions().respond({
                flowId: input.flowId,
                continuationHandle: input.continuationHandle,
                seq: input.seq,
                nonce: input.nonce,
                response: input.response,
            }),
        };
    }
    if (input.operation === 'login_cancel') {
        return {
            ok: true,
            response: await requireOperationSessions().cancel({
                flowId: input.flowId,
                continuationHandle: input.continuationHandle,
            }),
        };
    }
    if (context?.signal !== undefined && !(context.signal instanceof AbortSignal)) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'Codex login signal is invalid.');
    }
    const runtime = assertOperationRuntime(context?.providerRuntime);
    const selected = await selectContinuation(runtime, dependencies.continuationStore, input.handle);
    if (input.operation === 'login_describe') {
        return { ok: true, response: await describeLogin(runtime, selected) };
    }
    if (input.provider !== 'openai'
        || !PROVIDERS[0].methods.some((method) => method.key === input.method)) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'Codex login method is unsupported.');
    }
    if (input.method === 'api_key' || input.method === 'access_token') {
        return {
            ok: true,
            response: await runOneShotLogin(runtime, selected, input.method, input.apiKey),
        };
    }
    const controller = assertRetainedController(await runtime.launchRetainedOperation({
        command: [CODEX_EXECUTABLE, 'login', '--device-auth'],
    }, {
        environment: { NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        validateAfterLease: selected.validateAfterLease,
    }));
    const pending = waitForDeviceChallenge(
        controller,
        dependencies.challengeTimeoutMs ?? CHALLENGE_TIMEOUT_MS,
    );
    const initialState = await pending.challenge;
    const response = await requireOperationSessions().retainDeviceLogin({
        controller,
        authProvider: 'openai',
        method: 'device_code',
        initialState,
        onCompletion({ outcome } = {}) {
            const { code, signal } = outcome ?? {};
            if (!pending.collector.exceeded && code === 0 && (signal ?? null) === null) {
                return { status: 'completed' };
            }
            return { status: 'failed', error: 'provider_login_failed' };
        },
    });
    return { ok: true, response };
}

const productionDependencies = Object.freeze({
    continuationStore: Object.freeze({ selectContinuationRecordFromHome }),
    createOperationSessions: createCodexLoginOperationSessions,
    challengeTimeoutMs: CHALLENGE_TIMEOUT_MS,
});

export function executeTaskSessionControl(payload, context) {
    return executeTaskSessionControlWithDependencies(payload, context, productionDependencies);
}

export const __testables = Object.freeze({
    CHALLENGE_TIMEOUT_MS,
    CODEX_EXECUTABLE,
    CONTINUATION_HANDLE_RE,
    DEVICE_VERIFICATION_URL,
    FLOW_RE,
    HANDLE_RE,
    OUTPUT_LIMIT,
    PROVIDERS,
    assertRetainedController,
    executeTaskSessionControlWithDependencies,
    inputFromPayload,
    outputCollector,
    selectContinuation,
    waitForDeviceChallenge,
});
