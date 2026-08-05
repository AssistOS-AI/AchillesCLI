import {
    continuationDescriptor,
    continuationStoreForHome,
} from './continuation-store.mjs';
import {
    executeOpenCodeTask,
    readRecentOpenCodeModel,
} from './opencode-runner.mjs';

function invalidInput(error) {
    return {
        ok: false,
        outputText: '',
        error,
        code: 'PLOINKY_PROVIDER_RUNTIME_INPUT_INVALID',
    };
}

function requireOperationRuntime(providerRuntime) {
    if (!providerRuntime || providerRuntime.provider !== 'opencode'
        || providerRuntime.mode !== 'operation'
        || typeof providerRuntime.resolveHomeState !== 'function'
        || typeof providerRuntime.transitionToTask !== 'function'
        || typeof providerRuntime.spawnWith !== 'function') {
        const error = new Error('OpenCode continuation requires the admitted operation provider runtime.');
        error.code = 'PLOINKY_PROVIDER_RUNTIME_REQUIRED';
        throw error;
    }
    return providerRuntime;
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

function expectedWorkdir(projectDir) {
    return projectDir.slice('/workspace/'.length);
}

function stateChanged() {
    const error = new Error('OpenCode continuation state changed between resolution and provider execution.');
    error.code = 'PLOINKY_CONTINUATION_STATE_CHANGED';
    throw error;
}

async function continueProviderTaskWithDependencies(
    payload,
    { providerRuntime, signal } = {},
    dependencies,
) {
    const input = payload?.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return invalidInput('Invalid or missing input. Expected handle and prompt.');
    }
    const handle = String(input.handle || '').trim();
    const prompt = String(input.prompt || '').trim();
    const requestedModel = String(input.model || '').trim();
    if (!handle || !prompt) return invalidInput('handle and prompt are required.');
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
        return invalidInput('signal must be an AbortSignal.');
    }

    const runtime = requireOperationRuntime(providerRuntime);
    const selected = await runtime.resolveHomeState(async ({
        homePath,
        provider,
        runtimeKind,
    }) => {
        if (provider !== 'opencode') stateChanged();
        const continuationStore = dependencies.continuationStoreForHome(homePath);
        const record = continuationStore.readContinuationRecord(handle);
        const currentModel = requestedModel
            ? { model: requestedModel, variant: '' }
            : await dependencies.readRecentOpenCodeModel({ HOME: homePath });
        return Object.freeze({
            homePath,
            runtimeKind,
            record: Object.freeze({ ...record }),
            snapshot: recordSnapshot(record),
            model: String(currentModel?.model || ''),
            variant: String(currentModel?.variant || ''),
        });
    });

    runtime.transitionToTask();
    const validateAfterLease = ({
        homePath,
        provider,
        runtimeKind,
        mode,
        workdir,
    }) => {
        if (homePath !== selected.homePath
            || provider !== 'opencode'
            || runtimeKind !== selected.runtimeKind
            || mode !== 'task'
            || workdir !== expectedWorkdir(selected.record.projectDir)) {
            stateChanged();
        }
        const current = dependencies.continuationStoreForHome(homePath)
            .readContinuationRecord(handle);
        if (current.sessionId !== selected.record.sessionId
            || current.projectDir !== selected.record.projectDir
            || recordSnapshot(current) !== selected.snapshot) {
            stateChanged();
        }
    };

    const result = await dependencies.executeOpenCodeTask({
        prompt,
        projectDir: selected.record.projectDir,
        sessionId: selected.record.sessionId,
        model: selected.model,
        variant: selected.variant,
        providerRuntime: runtime,
        validateAfterLease,
    });
    if (!result.ok) {
        if (result.code === 'PLOINKY_CONTINUATION_STATE_CHANGED') stateChanged();
        return {
            ok: false,
            outputText: result.outputText || '',
            continuation: continuationDescriptor(handle),
            error: result.error,
            code: result.code,
            status: result.status,
            cause: result.cause,
        };
    }
    return {
        ok: true,
        outputText: result.outputText || '',
        continuation: continuationDescriptor(handle),
    };
}

const productionDependencies = Object.freeze({
    continuationStoreForHome,
    executeOpenCodeTask,
    readRecentOpenCodeModel,
});

export function continueProviderTask(payload, context) {
    return continueProviderTaskWithDependencies(payload, context, productionDependencies);
}

export const __testables = Object.freeze({
    continueProviderTaskWithDependencies,
    expectedWorkdir,
    recordSnapshot,
});
