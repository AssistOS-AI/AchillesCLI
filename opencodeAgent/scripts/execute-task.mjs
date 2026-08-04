import {
    continuationDescriptor,
    createContinuationHandle,
    writeContinuationRecord,
} from './continuation-store.mjs';
import { executeOpenCodeTask } from './opencode-runner.mjs';

function invalidInput(error) {
    return {
        ok: false,
        outputText: '',
        error,
        code: 'PLOINKY_PROVIDER_RUNTIME_INPUT_INVALID',
    };
}

async function executeProviderTaskWithStore(
    payload,
    { providerRuntime, signal } = {},
    continuationStore = { writeContinuationRecord },
) {
    const input = payload?.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return invalidInput('Invalid or missing input. Expected prompt and projectDir.');
    }
    const { prompt, projectDir, model } = input;
    if (typeof prompt !== 'string' || !prompt.trim()) {
        return invalidInput('prompt is required and must be a non-empty string.');
    }
    if (typeof projectDir !== 'string' || !projectDir.trim()) {
        return invalidInput('projectDir is required and must be a non-empty string.');
    }
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
        return invalidInput('signal must be an AbortSignal.');
    }

    const handle = createContinuationHandle();
    const result = await executeOpenCodeTask({
        prompt,
        projectDir: projectDir.trim(),
        model,
        captureSession: true,
        continuationHandle: handle,
        continuationStore,
        providerRuntime,
    });
    if (!result.sessionId || !result.continuationPersisted) {
        return {
            ok: false,
            outputText: result.outputText || '',
            error: result.error,
            code: result.code,
            status: result.status,
            cause: result.cause,
        };
    }

    return {
        ok: result.ok === true,
        outputText: result.outputText || '',
        continuation: continuationDescriptor(handle),
        ...(!result.ok ? {
            error: result.error,
            code: result.code,
            status: result.status,
            cause: result.cause,
        } : {}),
    };
}

export function executeProviderTask(payload, context) {
    return executeProviderTaskWithStore(payload, context);
}

export const __testables = Object.freeze({ executeProviderTaskWithStore });
