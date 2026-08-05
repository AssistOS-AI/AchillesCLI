#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawnTaskSandbox } from './task-sandbox.mjs';

const TERMINAL_ENVIRONMENT = Object.freeze(['TERM', 'COLORTERM', 'NO_COLOR', 'FORCE_COLOR']);
const SIGNAL_EXIT_CODES = Object.freeze({ SIGHUP: 129, SIGINT: 130, SIGTERM: 143 });
const CODEX_DEFENSE_ARGUMENTS = Object.freeze([
    '--sandbox',
    'workspace-write',
    '--ask-for-approval',
    'never',
]);
const MAX_WORKDIR_BYTES = 4095;

function codedError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function signalError(name) {
    const error = codedError(
        'PLOINKY_PROVIDER_RUNTIME_SIGNALLED',
        `interactive provider received ${name}`,
    );
    error.signal = name;
    error.exitCode = SIGNAL_EXIT_CODES[name] ?? 1;
    return error;
}

function throwIfAborted(signal) {
    signal?.throwIfAborted();
}

function hasCause(error, expected) {
    if (expected === undefined) return false;
    const pending = [error];
    const seen = new Set();
    while (pending.length > 0) {
        const current = pending.pop();
        if (current === expected) return true;
        if (!current || (typeof current !== 'object' && typeof current !== 'function')
            || seen.has(current)) continue;
        seen.add(current);
        if (current.cause !== undefined) pending.push(current.cause);
        if (Array.isArray(current.errors)) pending.push(...current.errors);
    }
    return false;
}

function inputError(message) {
    return codedError('PLOINKY_PROVIDER_RUNTIME_INPUT_INVALID', message);
}

function validateInteractiveWorkdir(value) {
    if (value === '/workspace') {
        throw codedError('PLOINKY_WORKDIR_ROOT_FORBIDDEN', 'the workspace root cannot be selected writable');
    }
    if (typeof value !== 'string' || !value || value.includes('\0')
        || Buffer.byteLength(value, 'utf8') > MAX_WORKDIR_BYTES) {
        throw codedError('PLOINKY_WORKDIR_INVALID', 'interactive WORKDIR is invalid');
    }
    let relative = value;
    if (value.startsWith('/workspace/')) relative = value.slice('/workspace/'.length);
    else if (value.startsWith('/')) {
        throw codedError('PLOINKY_WORKDIR_INVALID', 'interactive WORKDIR must be workspace-relative');
    }
    const parts = relative.split('/');
    if (!relative || relative.endsWith('/')
        || parts.some((part) => !part || part === '.' || part === '..')
        || parts[0] === '.data'
        || (parts[0] === '.ploinky' && (parts[1] !== 'repos' || !parts[2]))) {
        throw codedError('PLOINKY_WORKDIR_INVALID', 'interactive WORKDIR is invalid');
    }
    return value;
}

function parseInteractiveArguments(argv) {
    if (!Array.isArray(argv) || argv.length < 3 || argv[0] !== '--workdir' || argv[2] !== '--') {
        throw inputError('usage: --workdir <path> -- <provider argv>');
    }
    const workdir = validateInteractiveWorkdir(argv[1]);
    for (const value of argv.slice(3)) {
        if (typeof value !== 'string' || value.includes('\0')) {
            throw inputError('provider argv contains an invalid value');
        }
    }
    return Object.freeze({ workdir, args: Object.freeze(argv.slice(3)) });
}

function terminalEnvironment(env) {
    const result = {};
    for (const name of TERMINAL_ENVIRONMENT) {
        const value = env?.[name];
        if (typeof value === 'string' && value && !value.includes('\0')
            && Buffer.byteLength(value, 'utf8') <= 1024) {
            result[name] = value;
        }
    }
    return result;
}

function assertDependencies(dependencies) {
    for (const name of [
        'bootstrapAgentCredentialContext',
        'startScopedSoulBrokerRegistry',
        'createProviderTaskRuntime',
        'randomUUID',
        'spawnTaskSandbox',
    ]) {
        if (typeof dependencies?.[name] !== 'function') {
            throw new TypeError(`interactive provider dependency ${name} is required`);
        }
    }
    return dependencies;
}

async function closeInteractiveOwnership(providerRuntime, brokerRegistry) {
    let runtimeError = null;
    let brokerError = null;
    try { await providerRuntime?.close(); } catch (error) { runtimeError = error; }
    try { await brokerRegistry?.close(); } catch (error) { brokerError = error; }
    if (runtimeError && brokerError) {
        const combined = new AggregateError(
            [runtimeError, brokerError],
            runtimeError?.message || 'interactive provider cleanup failed',
            { cause: runtimeError },
        );
        if (runtimeError?.code) combined.code = runtimeError.code;
        throw combined;
    }
    if (runtimeError) throw runtimeError;
    if (brokerError) throw brokerError;
}

function exitCodeForCompletion(completion) {
    if (completion?.signal) return SIGNAL_EXIT_CODES[completion.signal] ?? 1;
    return Number.isInteger(completion?.code) ? completion.code : 1;
}

async function loadProductionDependencies() {
    const [credentialModule, brokerModule, runtimeModule] = await Promise.all([
        import('/Agent/lib/agentCredentialBootstrap.mjs'),
        import('/Agent/lib/scopedSoulBroker.mjs'),
        import('/Agent/lib/providerTaskRuntime.mjs'),
    ]);
    return assertDependencies({
        bootstrapAgentCredentialContext: credentialModule.bootstrapAgentCredentialContext,
        startScopedSoulBrokerRegistry: brokerModule.startScopedSoulBrokerRegistry,
        createProviderTaskRuntime: runtimeModule.createProviderTaskRuntime,
        randomUUID,
        spawnTaskSandbox,
    });
}

export async function runInteractiveCli(argv, env, options = {}) {
    const { signal, ...providedDependencies } = options;
    const dependencies = assertDependencies(providedDependencies);
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
        throw inputError('interactive signal must be an AbortSignal');
    }
    throwIfAborted(signal);
    const input = parseInteractiveArguments(argv);
    let brokerRegistry = null;
    let providerRuntime = null;
    let result = null;
    try {
        throwIfAborted(signal);
        const credentialContext = dependencies.bootstrapAgentCredentialContext(env);
        throwIfAborted(signal);
        brokerRegistry = await dependencies.startScopedSoulBrokerRegistry({ credentialContext });
        throwIfAborted(signal);
        providerRuntime = dependencies.createProviderTaskRuntime({
            credentialContext,
            brokerRegistry,
            mode: 'task',
            provider: 'codex',
            taskId: `interactive:${dependencies.randomUUID()}`,
            audience: 'interactive:codex',
            signal,
        });
        const handle = await providerRuntime.spawnWith(
            dependencies.spawnTaskSandbox,
            { workdir: input.workdir, args: [...CODEX_DEFENSE_ARGUMENTS, ...input.args] },
            {
                environment: terminalEnvironment(env),
                leaseMetadata: { purpose: 'codex-interactive' },
                stdio: ['inherit', 'inherit', 'inherit'],
            },
        );
        const completion = await handle.completion;
        throwIfAborted(signal);
        providerRuntime.assertBoundaryUsed();
        result = { code: completion?.code ?? null, signal: completion?.signal ?? null };
    } finally {
        try {
            await closeInteractiveOwnership(providerRuntime, brokerRegistry);
        } catch (cleanupError) {
            if (!signal?.aborted) throw cleanupError;
            throw new AggregateError(
                [signal.reason, cleanupError],
                cleanupError?.message || 'interactive provider cleanup failed after cancellation',
                { cause: signal.reason },
            );
        }
    }
    throwIfAborted(signal);
    return result;
}

export async function runInteractiveMain(runtimeProcess = process, dependencyLoader = loadProductionDependencies) {
    const controller = new AbortController();
    const handlers = new Map();
    for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        const handler = () => controller.abort(signalError(name));
        handlers.set(name, handler);
        runtimeProcess.once(name, handler);
    }
    try {
        const dependencies = await dependencyLoader();
        const completion = await runInteractiveCli(runtimeProcess.argv.slice(2), runtimeProcess.env, {
            ...dependencies,
            signal: controller.signal,
        });
        runtimeProcess.exitCode = exitCodeForCompletion(completion);
    } catch (error) {
        const abortReason = controller.signal.reason;
        if (controller.signal.aborted && hasCause(error, abortReason)) {
            runtimeProcess.exitCode = abortReason.exitCode;
            return;
        }
        throw error;
    } finally {
        for (const [name, handler] of handlers) runtimeProcess.removeListener(name, handler);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    runInteractiveMain().catch((error) => {
        process.stderr.write(`${error?.code ? `${error.code}: ` : ''}${error?.message || error}\n`);
        process.exitCode = 1;
    });
}

export const __testables = Object.freeze({
    CODEX_DEFENSE_ARGUMENTS,
    closeInteractiveOwnership,
    exitCodeForCompletion,
    hasCause,
    parseInteractiveArguments,
    signalError,
    terminalEnvironment,
    throwIfAborted,
    validateInteractiveWorkdir,
});
