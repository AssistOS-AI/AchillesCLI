#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawnTaskSandbox } from './task-sandbox.mjs';

const TERMINAL_ENVIRONMENT = Object.freeze(['TERM', 'COLORTERM', 'NO_COLOR', 'FORCE_COLOR']);
const SIGNAL_EXIT_CODES = Object.freeze({ SIGHUP: 129, SIGINT: 130, SIGTERM: 143 });

function inputError(message) {
    const error = new Error(message);
    error.code = 'PLOINKY_PROVIDER_RUNTIME_INPUT_INVALID';
    return error;
}

function parseInteractiveArguments(argv) {
    if (!Array.isArray(argv)
        || argv.length < 3
        || argv[0] !== '--workdir'
        || typeof argv[1] !== 'string'
        || !argv[1]
        || argv[1].includes('\0')
        || argv[2] !== '--') {
        throw inputError('usage: --workdir <path> -- <provider argv>');
    }
    for (const value of argv.slice(3)) {
        if (typeof value !== 'string' || value.includes('\0')) {
            throw inputError('provider argv contains an invalid value');
        }
    }
    return Object.freeze({ workdir: argv[1], args: Object.freeze(argv.slice(3)) });
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

function credentialContextForRuntime(env, dependencies) {
    const runtime = String(env?.PLOINKY_RUNTIME || '').trim().toLowerCase();
    if (runtime === 'bwrap') return dependencies.createBwrapAgentCredentialContext();
    if (runtime === 'container') return dependencies.createContainerAgentCredentialContext(env);
    const error = new Error('interactive provider execution requires an exact admitted bwrap or container credential context');
    error.code = 'PLOINKY_AGENT_CREDENTIAL_CONTEXT_REQUIRED';
    throw error;
}

function assertDependencies(dependencies) {
    for (const name of [
        'createBwrapAgentCredentialContext',
        'createContainerAgentCredentialContext',
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
    try {
        await providerRuntime?.close();
    } catch (error) {
        runtimeError = error;
    }
    try {
        await brokerRegistry.close();
    } catch (error) {
        brokerError = error;
    }
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
        import('/Agent/lib/agentCredentialContext.mjs'),
        import('/Agent/lib/scopedSoulBroker.mjs'),
        import('/Agent/lib/providerTaskRuntime.mjs'),
    ]);
    return assertDependencies({
        createBwrapAgentCredentialContext: credentialModule.createBwrapAgentCredentialContext,
        createContainerAgentCredentialContext: credentialModule.createContainerAgentCredentialContext,
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
    const input = parseInteractiveArguments(argv);
    const credentialContext = credentialContextForRuntime(env, dependencies);
    const brokerRegistry = await dependencies.startScopedSoulBrokerRegistry({ credentialContext });
    let providerRuntime = null;
    try {
        providerRuntime = dependencies.createProviderTaskRuntime({
            credentialContext,
            brokerRegistry,
            mode: 'task',
            provider: 'opencode',
            taskId: `interactive:${dependencies.randomUUID()}`,
            audience: 'interactive:opencode',
            signal,
        });
        const handle = await providerRuntime.spawnWith(
            dependencies.spawnTaskSandbox,
            { workdir: input.workdir, args: [...input.args] },
            {
                environment: terminalEnvironment(env),
                leaseMetadata: { purpose: 'opencode-interactive' },
                stdio: ['inherit', 'inherit', 'inherit'],
            },
        );
        const completion = await handle.completion;
        providerRuntime.assertBoundaryUsed();
        return { code: completion?.code ?? null, signal: completion?.signal ?? null };
    } finally {
        await closeInteractiveOwnership(providerRuntime, brokerRegistry);
    }
}

async function main() {
    const controller = new AbortController();
    const handlers = new Map();
    for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        const handler = () => controller.abort(new Error(`interactive provider received ${name}`));
        handlers.set(name, handler);
        process.once(name, handler);
    }
    try {
        const dependencies = await loadProductionDependencies();
        const completion = await runInteractiveCli(process.argv.slice(2), process.env, {
            ...dependencies,
            signal: controller.signal,
        });
        process.exitCode = exitCodeForCompletion(completion);
    } finally {
        for (const [name, handler] of handlers) process.removeListener(name, handler);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        process.stderr.write(`${error?.code ? `${error.code}: ` : ''}${error?.message || error}\n`);
        process.exitCode = 1;
    });
}

export const __testables = Object.freeze({
    closeInteractiveOwnership,
    credentialContextForRuntime,
    exitCodeForCompletion,
    parseInteractiveArguments,
    terminalEnvironment,
});
