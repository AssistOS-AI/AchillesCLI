import {
    continuationDescriptor,
    selectContinuationRecordFromHome,
    writeContinuationRecord,
} from './continuation-store.mjs';
import { executeCodexTask } from './codex-runner.mjs';

function invalidInput(error, code = 'PLOINKY_PROVIDER_RUNTIME_INPUT_INVALID') {
    return { ok: false, outputText: '', error, code };
}

function normalizeInput(payload) {
    const input = payload?.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { error: invalidInput('Invalid or missing Codex continuation input.') };
    }
    for (const key of Object.keys(input)) {
        if (key !== 'handle' && key !== 'prompt') {
            return { error: invalidInput(`unsupported Codex continuation input ${key}`) };
        }
    }
    const handle = typeof input.handle === 'string' ? input.handle.trim() : '';
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
    if (!handle || !prompt) return { error: invalidInput('handle and prompt are required') };
    return { input: { handle, prompt } };
}

function runtimeError(code, message, options) {
    const error = new Error(message, options);
    error.code = code;
    return error;
}

function selectedWorkdir(selected, expectedHandle) {
    if (!selected || typeof selected !== 'object'
        || selected.handle !== expectedHandle
        || typeof selected.threadId !== 'string' || !selected.threadId
        || selected.threadId !== selected.threadId.trim() || selected.threadId.includes('\0')
        || typeof selected.projectDir !== 'string'
        || selected.projectDir !== selected.projectDir.trim()
        || !selected.projectDir.startsWith('/workspace/')) {
        throw runtimeError(
            'PLOINKY_PROVIDER_CONTINUATION_INVALID',
            'Codex continuation resolver returned invalid trusted state',
        );
    }
    const workdir = selected.projectDir.slice('/workspace/'.length);
    if (!workdir || workdir.split('/').some((part) => !part || part === '.' || part === '..')) {
        throw runtimeError(
            'PLOINKY_PROVIDER_CONTINUATION_INVALID',
            'Codex continuation resolver returned an invalid project identity',
        );
    }
    return workdir;
}

function assertResolverBoundary({ homePath, provider, runtimeKind }) {
    const expectedHomePath = runtimeKind === 'bwrap'
        ? '/home/agent'
        : (runtimeKind === 'container' ? '/root' : '');
    if (provider !== 'codex' || !expectedHomePath || homePath !== expectedHomePath) {
        throw runtimeError(
            'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID',
            'Codex continuation resolver received the wrong runtime HOME boundary',
        );
    }
    return Object.freeze({ homePath, provider, runtimeKind });
}

function continuationChanged(message, cause) {
    return runtimeError(
        'PLOINKY_PROVIDER_CONTINUATION_CHANGED',
        message,
        cause ? { cause } : undefined,
    );
}

async function continueProviderTaskWithStore(
    payload,
    { providerRuntime, signal } = {},
    continuationStore = { selectContinuationRecordFromHome, writeContinuationRecord },
) {
    const normalized = normalizeInput(payload);
    if (normalized.error) return normalized.error;
    if (!providerRuntime || typeof providerRuntime.spawnWith !== 'function'
        || typeof providerRuntime.resolveHomeState !== 'function'
        || typeof providerRuntime.transitionToTask !== 'function') {
        return invalidInput(
            'Codex requires an injected canonical providerRuntime capability.',
            'PLOINKY_PROVIDER_RUNTIME_REQUIRED',
        );
    }
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
        return invalidInput('signal must be an AbortSignal.');
    }
    let selected;
    let selectedBoundary;
    try {
        selected = await providerRuntime.resolveHomeState(({ homePath, provider, runtimeKind }) => {
            if (selectedBoundary) {
                throw runtimeError(
                    'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID',
                    'Codex continuation resolver boundary was invoked more than once',
                );
            }
            selectedBoundary = assertResolverBoundary({ homePath, provider, runtimeKind });
            return continuationStore.selectContinuationRecordFromHome(
                homePath,
                normalized.input.handle,
            );
        });
        if (!selectedBoundary) {
            throw runtimeError(
                'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID',
                'Codex continuation resolver returned without an admitted HOME boundary',
            );
        }
        selectedWorkdir(selected, normalized.input.handle);
        if (providerRuntime.transitionToTask() !== 'task') {
            throw runtimeError(
                'PLOINKY_PROVIDER_RUNTIME_TRANSITION_INVALID',
                'Codex continuation did not enter the canonical task runtime',
            );
        }
    } catch (error) {
        return invalidInput(
            error?.message || 'invalid Codex continuation record',
            typeof error?.code === 'string'
                ? error.code
                : 'PLOINKY_PROVIDER_RUNTIME_INPUT_INVALID',
        );
    }

    const validateAfterLease = ({ homePath, provider, runtimeKind, mode, workdir }) => {
        const expectedWorkdir = selectedWorkdir(selected, normalized.input.handle);
        if (provider !== selectedBoundary.provider
            || runtimeKind !== selectedBoundary.runtimeKind
            || homePath !== selectedBoundary.homePath
            || mode !== 'task'
            || workdir !== expectedWorkdir
            || selected.projectDir !== `/workspace/${workdir}`) {
            throw continuationChanged('Codex continuation runtime identity changed before task launch');
        }
        let current;
        try {
            current = continuationStore.selectContinuationRecordFromHome(
                homePath,
                normalized.input.handle,
            );
        } catch (error) {
            throw continuationChanged('Codex continuation state could not be revalidated', error);
        }
        if (current?.handle !== selected.handle
            || current?.threadId !== selected.threadId
            || current?.projectDir !== selected.projectDir) {
            throw continuationChanged('Codex continuation state changed before task launch');
        }
    };

    const result = await executeCodexTask({
        prompt: normalized.input.prompt,
        projectDir: selected.projectDir,
        threadId: selected.threadId,
        validateAfterLease,
        providerRuntime,
        afterExit({ code, threadId, projectDir }) {
            if (code !== 0 || !threadId) return;
            continuationStore.writeContinuationRecord(normalized.input.handle, {
                threadId,
                projectDir,
            });
        },
    });
    return {
        ok: result.ok === true,
        outputText: result.outputText || '',
        continuation: continuationDescriptor(normalized.input.handle),
        ...(!result.ok ? {
            error: result.error || 'Codex continuation failed.',
            code: result.code,
            ...(result.cause ? { cause: result.cause } : {}),
        } : {}),
    };
}

export function continueProviderTask(payload, context) {
    return continueProviderTaskWithStore(payload, context);
}

export const __testables = Object.freeze({ continueProviderTaskWithStore, normalizeInput });
