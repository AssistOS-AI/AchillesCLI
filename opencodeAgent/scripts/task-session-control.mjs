import { continuationStoreForHome } from './continuation-store.mjs';
import {
    createOpenCodeLoginOperationSessions,
} from './login-operation-sessions.mjs';
import {
    OPENCODE_LOGIN_PROVIDERS,
    selectLoginMethod,
} from './login-methods.mjs';
import {
    parseOpenCodeDeviceLoginOutput,
    stripAnsi,
} from './opencode-login-output.mjs';

const OPENCODE_EXECUTABLE = '/home/agent/.opencode/bin/opencode';
const OUTPUT_LIMIT = 32 * 1024;
const CHALLENGE_TIMEOUT_MS = 30_000;
const HANDLE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FLOW_RE = /^login:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTINUATION_HANDLE_RE = /^[A-Za-z0-9_-]{43}$/;

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
            throw providerError(
                'PLOINKY_PROVIDER_INPUT_INVALID',
                `${label} contains unsupported field ${key}.`,
            );
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
    exactPlainObject(payload, 'OpenCode control payload');
    let input;
    if (Object.prototype.hasOwnProperty.call(payload, 'input')) {
        exactKeys(
            payload,
            new Set(['input', 'metadata', 'tool']),
            new Set(['input']),
            'OpenCode control payload',
        );
        if (payload.tool !== undefined && payload.tool !== 'task-session-control') {
            throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'OpenCode control tool is invalid.');
        }
        input = exactPlainObject(payload.input, 'OpenCode control input');
    } else {
        input = payload;
    }
    const operation = typeof input.operation === 'string' ? input.operation : '';
    const fields = {
        login_describe: new Set(['operation', 'handle']),
        login_start: new Set(['operation', 'handle', 'provider', 'method', 'apiKey', 'inputs']),
        login_status: new Set(['operation', 'flowId', 'continuationHandle']),
        login_respond: new Set([
            'operation', 'flowId', 'continuationHandle', 'seq', 'nonce', 'response',
        ]),
        login_cancel: new Set(['operation', 'flowId', 'continuationHandle']),
    }[operation];
    if (!fields) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'OpenCode login operation is unsupported.');
    }
    const controlOperation = ['login_status', 'login_respond', 'login_cancel'].includes(operation);
    exactKeys(
        input,
        fields,
        controlOperation
            ? new Set(['operation', 'flowId', 'continuationHandle'])
            : new Set(['operation', 'handle']),
        'OpenCode control input',
    );
    if (!controlOperation && (typeof input.handle !== 'string' || !HANDLE_RE.test(input.handle))) {
        throw providerError(
            'PLOINKY_PROVIDER_INPUT_INVALID',
            'OpenCode task continuation handle is invalid.',
        );
    }
    if (controlOperation && (typeof input.flowId !== 'string' || !FLOW_RE.test(input.flowId))) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'OpenCode login flow is invalid.');
    }
    if (controlOperation
        && (typeof input.continuationHandle !== 'string'
            || !CONTINUATION_HANDLE_RE.test(input.continuationHandle))) {
        throw providerError(
            'PLOINKY_PROVIDER_INPUT_INVALID',
            'OpenCode login continuation handle is invalid.',
        );
    }
    if (operation === 'login_respond'
        && (!Number.isSafeInteger(input.seq) || input.seq < 1
            || typeof input.nonce !== 'string'
            || !/^[A-Za-z0-9_-]{16,128}$/u.test(input.nonce)
            || typeof input.response !== 'string' || !input.response
            || input.response.includes('\0')
            || Buffer.byteLength(input.response, 'utf8') > 8 * 1024)) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'OpenCode login response is invalid.');
    }
    return Object.freeze({ ...input, operation });
}

function assertOperationRuntime(providerRuntime) {
    if (!providerRuntime || typeof providerRuntime !== 'object'
        || providerRuntime.provider !== 'opencode'
        || providerRuntime.mode !== 'operation'
        || typeof providerRuntime.resolveHomeState !== 'function'
        || typeof providerRuntime.continueOperation !== 'function'
        || typeof providerRuntime.launch !== 'function'
        || typeof providerRuntime.launchRetainedOperation !== 'function') {
        throw providerError(
            'PLOINKY_PROVIDER_RUNTIME_REQUIRED',
            'OpenCode login requires the admitted operation provider runtime.',
        );
    }
    return providerRuntime;
}

function assertLaunch(launch) {
    if (!launch || typeof launch !== 'object'
        || launch.helper !== '/usr/local/libexec/ploinky-bwrap-launch'
        || launch.provider !== 'opencode'
        || launch.mode !== 'operation'
        || launch.workdir !== null
        || launch.cwd !== '/workspace/operation') {
        throw providerError(
            'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID',
            'OpenCode login did not receive the canonical private operation boundary.',
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
            'OpenCode login received an invalid operation handle.',
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
            'OpenCode device login received an invalid retained controller.',
        );
    }
    assertLaunch(controller.launch);
    return controller;
}

function recordSnapshot(record) {
    return JSON.stringify({
        version: record.version,
        provider: record.provider,
        sessionId: record.sessionId,
        projectDir: record.projectDir,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    });
}

function assertSelectedRecord(record) {
    if (!record || typeof record !== 'object'
        || record.provider !== 'opencode'
        || typeof record.sessionId !== 'string' || !record.sessionId
        || typeof record.projectDir !== 'string' || !record.projectDir.startsWith('/workspace/')) {
        throw providerError(
            'PLOINKY_PROVIDER_CONTINUATION_INVALID',
            'OpenCode login received invalid trusted continuation state.',
        );
    }
    return record;
}

async function selectContinuation(runtime, continuationStore, handle) {
    let boundary;
    const record = assertSelectedRecord(await runtime.resolveHomeState((context) => {
        const validRuntimeHome = (context.runtimeKind === 'bwrap' && context.homePath === '/home/agent')
            || (context.runtimeKind === 'container' && context.homePath === '/root');
        if (context.provider !== 'opencode' || !validRuntimeHome) {
            throw providerError(
                'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID',
                'OpenCode login received the wrong runtime HOME boundary.',
            );
        }
        boundary = Object.freeze({ ...context });
        return continuationStore.continuationStoreForHome(context.homePath)
            .readContinuationRecord(handle);
    }));
    if (!boundary || runtime.continueOperation() !== 'operation') {
        throw providerError(
            'PLOINKY_PROVIDER_RUNTIME_TRANSITION_INVALID',
            'OpenCode login could not enter the canonical operation runtime.',
        );
    }
    const snapshot = recordSnapshot(record);
    return Object.freeze({
        validateAfterLease(context) {
            if (context.provider !== 'opencode'
                || context.homePath !== boundary.homePath
                || context.runtimeKind !== boundary.runtimeKind
                || context.mode !== 'operation'
                || context.workdir !== null) {
                throw providerError(
                    'PLOINKY_PROVIDER_CONTINUATION_CHANGED',
                    'OpenCode login runtime identity changed before launch.',
                );
            }
            let current;
            try {
                current = continuationStore.continuationStoreForHome(context.homePath)
                    .readContinuationRecord(handle);
            } catch (cause) {
                throw providerError(
                    'PLOINKY_PROVIDER_CONTINUATION_CHANGED',
                    'OpenCode login continuation state could not be revalidated.',
                    { cause },
                );
            }
            if (recordSnapshot(current) !== snapshot) {
                throw providerError(
                    'PLOINKY_PROVIDER_CONTINUATION_CHANGED',
                    'OpenCode login continuation state changed before launch.',
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
        const appended = buffer.toString('utf8');
        if (bytes > OUTPUT_LIMIT) {
            exceeded = true;
            output = `${output}${appended}`.slice(-OUTPUT_LIMIT);
        } else {
            output += appended;
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

function boundedValue(value, label) {
    if (typeof value !== 'string' || !value || /[\u0000-\u001f\u007f]/u.test(value)
        || Buffer.byteLength(value, 'utf8') > 4 * 1024) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', `${label} is invalid.`);
    }
    return value;
}

function activePrompts(method, rawInputs) {
    const inputs = rawInputs === undefined ? {} : exactPlainObject(rawInputs, 'OpenCode prompt inputs');
    const declared = new Set((method.prompts || []).map((prompt) => prompt.key));
    for (const key of Object.keys(inputs)) {
        if (!declared.has(key)) {
            throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'OpenCode prompt input is unsupported.');
        }
    }
    const normalized = {};
    const prompts = [];
    const terminalLabels = [
        ...(method.prompts || []).map((prompt) => prompt.message),
        'Enter your API key',
        'Go to:',
        'Enter code:',
        'Login successful',
        'Failed to authorize',
    ].filter(Boolean);
    for (const prompt of method.prompts || []) {
        const active = !prompt.when
            || (prompt.when.op === 'eq' && normalized[prompt.when.key] === prompt.when.value);
        if (!active) {
            if (Object.prototype.hasOwnProperty.call(inputs, prompt.key)) {
                throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'OpenCode prompt input is inactive.');
            }
            continue;
        }
        let value = inputs[prompt.key];
        if (prompt.type === 'select' && value === undefined) value = prompt.options[0].value;
        value = boundedValue(value, `OpenCode ${prompt.key} prompt input`);
        if (prompt.type === 'select'
            && !prompt.options.some((option) => option.value === value)) {
            throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'OpenCode prompt input is invalid.');
        }
        if (prompt.type !== 'select' && terminalLabels.some((label) => value.includes(label))) {
            throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'OpenCode prompt input is ambiguous.');
        }
        normalized[prompt.key] = value;
        prompts.push(Object.freeze({ prompt, value }));
    }
    return Object.freeze(prompts);
}

function startPromptDriver(controller, collector, prompts, apiKey) {
    const answered = new Set();
    let secretSent = false;
    const inspect = () => {
        if (collector.exceeded) return;
        const output = stripAnsi(collector.output);
        for (const { prompt, value } of prompts) {
            if (answered.has(prompt.key) || !output.includes(prompt.message)) continue;
            answered.add(prompt.key);
            if (prompt.type === 'select') {
                const index = prompt.options.findIndex((option) => option.value === value);
                controller.stdin.write(`${'\u001b[B'.repeat(index)}\r`);
            } else {
                controller.stdin.write(`${value}\r`);
            }
        }
        if (apiKey !== undefined && !secretSent && /Enter your API key/iu.test(output)) {
            secretSent = true;
            controller.stdin.end(`${apiKey}\r`);
        }
    };
    const unsubscribe = collector.onChange(inspect);
    inspect();
    return Object.freeze({
        get secretSent() { return secretSent; },
        unsubscribe,
    });
}

function deviceVerificationUri(method, prompts) {
    if (method.verificationUri !== 'https://github.com/login/device') {
        return method.verificationUri;
    }
    const deploymentType = prompts.find(({ prompt }) => prompt.key === 'deploymentType')?.value;
    if (deploymentType !== 'enterprise') return method.verificationUri;
    const value = prompts.find(({ prompt }) => prompt.key === 'enterpriseUrl')?.value;
    let parsed;
    try {
        parsed = new URL(value.includes('://') ? value : `https://${value}`);
    } catch (_) {
        throw providerError(
            'PLOINKY_PROVIDER_INPUT_INVALID',
            'OpenCode enterprise URL is invalid.',
        );
    }
    if (!['http:', 'https:'].includes(parsed.protocol)
        || parsed.username || parsed.password
        || (parsed.pathname !== '/' && parsed.pathname !== '')
        || parsed.search || parsed.hash) {
        throw providerError(
            'PLOINKY_PROVIDER_INPUT_INVALID',
            'OpenCode enterprise URL is invalid.',
        );
    }
    return `https://${parsed.host}/login/device`;
}

function waitForDeviceChallenge(controller, verificationUri, collector, timeoutMs, signal) {
    const challenge = new Promise((resolve, reject) => {
        let settled = false;
        let unsubscribe = () => {};
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            unsubscribe();
            signal?.removeEventListener('abort', abort);
            if (error) reject(error);
            else resolve(value);
        };
        const inspect = () => {
            if (collector.exceeded) {
                finish(providerError(
                    'PLOINKY_OPENCODE_LOGIN_FAILED',
                    'OpenCode device login output was invalid.',
                ));
                return;
            }
            const parsed = parseOpenCodeDeviceLoginOutput(
                collector.output,
                verificationUri,
            );
            if (parsed.url === verificationUri && parsed.code) {
                finish(null, Object.freeze({
                    status: 'running',
                    challenge: Object.freeze({
                        type: 'device_code',
                        verificationUri,
                        userCode: parsed.code,
                    }),
                }));
            }
        };
        const abort = () => finish(providerError(
            'PLOINKY_OPENCODE_LOGIN_FAILED',
            'OpenCode device login challenge was interrupted.',
        ));
        const timer = setTimeout(() => finish(providerError(
            'PLOINKY_OPENCODE_LOGIN_FAILED',
            'OpenCode device login did not produce a challenge.',
        )), timeoutMs);
        timer.unref?.();
        unsubscribe = collector.onChange(inspect);
        signal?.addEventListener('abort', abort, { once: true });
        controller.completion.then(() => finish(providerError(
            'PLOINKY_OPENCODE_LOGIN_FAILED',
            'OpenCode device login exited before producing a challenge.',
        )), () => finish(providerError(
            'PLOINKY_OPENCODE_LOGIN_FAILED',
            'OpenCode device login failed before producing a challenge.',
        )));
        if (signal?.aborted) abort();
        else inspect();
    });
    return challenge;
}

function loginCommand(provider, method) {
    return [
        OPENCODE_EXECUTABLE,
        'auth',
        'login',
        '--pure',
        '-p',
        provider.key,
        '-m',
        method.label,
    ];
}

async function runOneShotLogin(runtime, selected, provider, method, input) {
    const apiKey = boundedValue(input.apiKey, 'OpenCode login secret');
    const prompts = activePrompts(method, input.inputs);
    const handle = assertOperationHandle(await runtime.launch({
        command: loginCommand(provider, method),
    }, {
        environment: { NO_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
        validateAfterLease: selected.validateAfterLease,
    }));
    if (!handle.child.stdin || !handle.child.stdout || !handle.child.stderr) {
        throw providerError(
            'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID',
            'OpenCode credential login did not receive its canonical pipe boundary.',
        );
    }
    const collector = outputCollector(handle.child.stdout, handle.child.stderr);
    const driver = startPromptDriver(handle.child, collector, prompts, apiKey);
    let outcome;
    try { outcome = await handle.completion; } catch (_) { }
    driver.unsubscribe();
    const output = stripAnsi(collector.output);
    const completionMarker = method.completionMarker === 'login_successful'
        ? /Login successful/iu.test(output)
        : /(?:^|\n)[^\r\n]{0,32}\bDone\b/iu.test(output);
    if (collector.exceeded || !driver.secretSent
        || outcome?.code !== 0 || outcome?.signal
        || /Failed to authorize/iu.test(output) || !completionMarker) {
        throw providerError('PLOINKY_OPENCODE_LOGIN_FAILED', 'OpenCode credential login failed.');
    }
    return {
        type: 'login-flow',
        version: 1,
        status: 'completed',
        provider: provider.key,
        method: method.key,
    };
}

async function describeLogin(runtime, selected) {
    const handle = assertOperationHandle(await runtime.launch({
        command: [OPENCODE_EXECUTABLE, 'auth', 'login', '--help'],
    }, {
        stdio: ['ignore', 'ignore', 'ignore'],
        validateAfterLease: selected.validateAfterLease,
    }));
    let outcome;
    try { outcome = await handle.completion; } catch (_) { }
    if (outcome?.code !== 0 || outcome?.signal) {
        throw providerError('PLOINKY_OPENCODE_LOGIN_FAILED', 'OpenCode login catalog probe failed.');
    }
    return { type: 'login-catalog', version: 1, providers: OPENCODE_LOGIN_PROVIDERS };
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
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'OpenCode login signal is invalid.');
    }
    const runtime = assertOperationRuntime(context?.providerRuntime);
    const selected = await selectContinuation(runtime, dependencies.continuationStore, input.handle);
    if (input.operation === 'login_describe') {
        return { ok: true, response: await describeLogin(runtime, selected) };
    }
    const selectedMethod = selectLoginMethod(input.provider, input.method);
    if (!selectedMethod) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'OpenCode login method is unsupported.');
    }
    const { provider, method } = selectedMethod;
    if (method.kind !== 'device_code') {
        return {
            ok: true,
            response: await runOneShotLogin(runtime, selected, provider, method, input),
        };
    }
    if (input.apiKey !== undefined) {
        throw providerError('PLOINKY_PROVIDER_INPUT_INVALID', 'OpenCode device login cannot accept a secret.');
    }
    const prompts = activePrompts(method, input.inputs);
    const verificationUri = deviceVerificationUri(method, prompts);
    const controller = assertRetainedController(await runtime.launchRetainedOperation({
        command: loginCommand(provider, method),
    }, {
        environment: { NO_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
        validateAfterLease: selected.validateAfterLease,
    }));
    const collector = outputCollector(controller.stdout, controller.stderr);
    const driver = startPromptDriver(controller, collector, prompts);
    let initialState;
    try {
        initialState = await waitForDeviceChallenge(
            controller,
            verificationUri,
            collector,
            dependencies.challengeTimeoutMs ?? CHALLENGE_TIMEOUT_MS,
            context?.signal,
        );
    } catch (error) {
        driver.unsubscribe();
        throw error;
    }
    const response = await requireOperationSessions().retainDeviceLogin({
        controller,
        authProvider: provider.key,
        method: method.key,
        initialState,
        onCompletion({ outcome } = {}) {
            driver.unsubscribe();
            const { code, signal } = outcome ?? {};
            if (code === 0 && (signal ?? null) === null
                && /Login successful/iu.test(stripAnsi(collector.output))) {
                return { status: 'completed' };
            }
            return { status: 'failed', error: 'provider_login_failed' };
        },
    });
    return { ok: true, response };
}

const productionDependencies = Object.freeze({
    continuationStore: Object.freeze({ continuationStoreForHome }),
    createOperationSessions: createOpenCodeLoginOperationSessions,
    challengeTimeoutMs: CHALLENGE_TIMEOUT_MS,
});

export function executeTaskSessionControl(payload, context) {
    return executeTaskSessionControlWithDependencies(payload, context, productionDependencies);
}

export const __testables = Object.freeze({
    CHALLENGE_TIMEOUT_MS,
    CONTINUATION_HANDLE_RE,
    FLOW_RE,
    HANDLE_RE,
    OPENCODE_EXECUTABLE,
    OUTPUT_LIMIT,
    activePrompts,
    assertRetainedController,
    deviceVerificationUri,
    executeTaskSessionControlWithDependencies,
    inputFromPayload,
    outputCollector,
    selectContinuation,
    startPromptDriver,
    waitForDeviceChallenge,
});
