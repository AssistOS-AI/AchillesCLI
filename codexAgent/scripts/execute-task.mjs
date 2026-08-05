import { executeCodexTask } from './codex-runner.mjs';
import {
    continuationDescriptor,
    createContinuationHandle,
    writeContinuationRecord,
} from './continuation-store.mjs';

function invalidInput(error, code = 'PLOINKY_PROVIDER_RUNTIME_INPUT_INVALID') {
    return { ok: false, outputText: '', error, code };
}

function normalizeInput(payload) {
    const input = payload?.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { error: invalidInput('Invalid or missing input. Expected prompt and projectDir.') };
    }
    const allowed = new Set(['prompt', 'projectDir', 'model']);
    for (const key of Object.keys(input)) {
        if (!allowed.has(key)) return { error: invalidInput(`unsupported Codex task input ${key}`) };
    }
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
    const projectDir = typeof input.projectDir === 'string' ? input.projectDir.trim() : '';
    const model = typeof input.model === 'string' ? input.model.trim() : '';
    if (!prompt) return { error: invalidInput('prompt is required and must be a non-empty string.') };
    if (!projectDir) return { error: invalidInput('projectDir is required and must be a non-empty string.') };
    if (input.model !== undefined && typeof input.model !== 'string') {
        return { error: invalidInput('model must be a string when supplied.') };
    }
    return { input: { prompt, projectDir, model } };
}

async function executeProviderTaskWithStore(
    payload,
    { providerRuntime, signal } = {},
    continuationStore = { writeContinuationRecord },
) {
    const normalized = normalizeInput(payload);
    if (normalized.error) return normalized.error;
    if (!providerRuntime || typeof providerRuntime.spawnWith !== 'function') {
        return invalidInput(
            'Codex requires an injected canonical providerRuntime capability.',
            'PLOINKY_PROVIDER_RUNTIME_REQUIRED',
        );
    }
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
        return invalidInput('signal must be an AbortSignal.');
    }

    const handle = createContinuationHandle();
    let continuationPersisted = false;
    const result = await executeCodexTask({
        ...normalized.input,
        providerRuntime,
        afterExit({ threadId, projectDir }) {
            if (!threadId) return;
            continuationStore.writeContinuationRecord(handle, { threadId, projectDir });
            continuationPersisted = true;
        },
    });
    if (!result.threadId || !continuationPersisted) {
        return {
            ok: false,
            outputText: result.outputText || '',
            error: result.error || 'Codex did not report a resumable thread id.',
            code: result.code || 'PLOINKY_PROVIDER_THREAD_REQUIRED',
            ...(result.cause ? { cause: result.cause } : {}),
        };
    }
    return {
        ok: result.ok === true,
        outputText: result.outputText || '',
        continuation: continuationDescriptor(handle),
        ...(!result.ok ? {
            error: result.error || 'Codex task failed.',
            code: result.code,
            ...(result.cause ? { cause: result.cause } : {}),
        } : {}),
    };
}

export function executeProviderTask(payload, context) {
    return executeProviderTaskWithStore(payload, context);
}

export const __testables = Object.freeze({ executeProviderTaskWithStore, normalizeInput });
