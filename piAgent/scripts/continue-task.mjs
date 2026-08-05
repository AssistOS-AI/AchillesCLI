import {
    continuationDescriptor,
    continuationStoreForHome,
} from './continuation-store.mjs';
import {
    collectPiResult,
    createContainerLogStream,
    piArguments,
    piTaskFailure,
    summarizeFailure,
    summarizeOutput,
} from './execute-task.mjs';
import { spawnTaskSandbox } from './task-sandbox.mjs';

function invalidInput(message) {
    const error = new TypeError(message);
    error.code = 'PLOINKY_PROVIDER_INPUT_INVALID';
    return error;
}

function continuationInput(payload) {
    const input = payload?.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw invalidInput('PI continuation input must be an object');
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
        throw invalidInput('PI continuation input must be a plain object');
    }
    const values = {};
    const allowed = new Set(['handle', 'prompt', 'model']);
    for (const name of Reflect.ownKeys(input)) {
        if (typeof name !== 'string' || !allowed.has(name)) {
            throw invalidInput(`PI continuation input contains unknown field ${String(name)}`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(input, name);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            throw invalidInput(`PI continuation input field ${name} must be a data property`);
        }
        values[name] = descriptor.value;
    }
    if (typeof values.handle !== 'string' || !values.handle
        || values.handle !== values.handle.trim()) {
        throw invalidInput('handle is required and must be an exact non-empty string');
    }
    try {
        continuationDescriptor(values.handle);
    } catch {
        throw invalidInput('handle must be an opaque PI continuation handle');
    }
    if (typeof values.prompt !== 'string' || !values.prompt
        || values.prompt !== values.prompt.trim()) {
        throw invalidInput('prompt is required and must be an exact non-empty string');
    }
    if (values.model !== undefined && (typeof values.model !== 'string'
        || values.model !== values.model.trim())) {
        throw invalidInput('model must be an exact string');
    }
    return Object.freeze({
        handle: values.handle,
        prompt: values.prompt,
        model: values.model || '',
    });
}

function continuationMismatch(message) {
    const error = new Error(message);
    error.code = 'PLOINKY_PI_CONTINUATION_MISMATCH';
    return error;
}

function selectedContinuation(home, record, handle) {
    if (!home || typeof home !== 'object'
        || home.provider !== 'pi'
        || typeof home.homePath !== 'string'
        || typeof home.runtimeKind !== 'string') {
        throw continuationMismatch('PI continuation resolved outside the selected runtime HOME');
    }
    if (!record || record.provider !== 'pi' || record.sessionId !== handle
        || typeof record.projectDir !== 'string'
        || !record.projectDir.startsWith('/workspace/')) {
        throw continuationMismatch('PI continuation record does not match the requested session');
    }
    const workdir = record.projectDir.slice('/workspace/'.length);
    if (!workdir || workdir.startsWith('/')) {
        throw continuationMismatch('PI continuation record has an invalid workspace identity');
    }
    return Object.freeze({
        handle,
        homePath: home.homePath,
        projectDir: record.projectDir,
        provider: home.provider,
        runtimeKind: home.runtimeKind,
        sessionDir: record.sessionDir,
        sessionId: record.sessionId,
        workdir,
    });
}

function revalidateContinuation(home, selected, storeForHome) {
    if (!home || typeof home !== 'object'
        || home.provider !== selected.provider
        || home.mode !== 'task'
        || home.workdir !== selected.workdir
        || home.homePath !== selected.homePath
        || home.runtimeKind !== selected.runtimeKind) {
        throw continuationMismatch('PI continuation task boundary changed after resolution');
    }
    const record = storeForHome(home.homePath).readContinuationRecord(selected.handle);
    if (record.provider !== 'pi'
        || record.sessionId !== selected.sessionId
        || record.sessionDir !== selected.sessionDir
        || record.projectDir !== selected.projectDir) {
        throw continuationMismatch('PI continuation state changed before task activation');
    }
    return Object.freeze({ projectDir: record.projectDir });
}

async function continueProviderTaskWithStoreFactory(
    payload,
    { providerRuntime, signal } = {},
    storeForHome = continuationStoreForHome,
) {
    if (!providerRuntime || typeof providerRuntime !== 'object'
        || providerRuntime.provider !== 'pi'
        || providerRuntime.mode !== 'operation'
        || typeof providerRuntime.resolveHomeState !== 'function'
        || typeof providerRuntime.transitionToTask !== 'function'
        || typeof providerRuntime.spawnWith !== 'function') {
        return piTaskFailure(Object.assign(
            new Error('PI continuation requires the trusted operation provider runtime'),
            { code: 'PLOINKY_PROVIDER_RUNTIME_REQUIRED' },
        ));
    }
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
        return piTaskFailure(invalidInput('PI continuation signal must be an AbortSignal'));
    }
    if (typeof storeForHome !== 'function') {
        return piTaskFailure(invalidInput('PI continuation state resolver must be a function'));
    }

    let input;
    try {
        input = continuationInput(payload);
    } catch (error) {
        return piTaskFailure(error);
    }
    const continuation = continuationDescriptor(input.handle);

    try {
        const selected = await providerRuntime.resolveHomeState((home) => {
            const record = storeForHome(home.homePath).readContinuationRecord(input.handle);
            return selectedContinuation(home, record, input.handle);
        });
        if (providerRuntime.transitionToTask() !== 'task' || providerRuntime.mode !== 'task') {
            throw continuationMismatch('PI continuation runtime did not enter task mode');
        }

        const args = piArguments({
            prompt: input.prompt,
            model: input.model,
            handle: selected.handle,
        });
        const model = args[args.indexOf('--model') + 1];
        const runtime = await providerRuntime.spawnWith(
            spawnTaskSandbox,
            { workdir: selected.workdir, args },
            {
                environment: Object.freeze({
                    PLOINKY_PROVIDER_MODEL: model,
                    PLOINKY_PROVIDER_SESSION_ID: selected.handle,
                }),
                stdio: ['ignore', 'pipe', 'pipe'],
                validateAfterLease: (home) => revalidateContinuation(
                    home,
                    selected,
                    storeForHome,
                ),
            },
        );
        const result = await collectPiResult(runtime, { logStream: createContainerLogStream() });
        if (result.assistantError || result.code !== 0 || result.signal) {
            return {
                ok: false,
                error: result.assistantError || summarizeFailure(result),
                outputText: summarizeOutput(result, { preferStderr: true }),
                continuation,
            };
        }
        return {
            ok: true,
            outputText: result.finalOutputText || summarizeOutput(result),
            continuation,
        };
    } catch (error) {
        return piTaskFailure(error, continuation);
    }
}

export function continueProviderTask(payload, context) {
    return continueProviderTaskWithStoreFactory(payload, context);
}

export const __testables = Object.freeze({
    continuationInput,
    continueProviderTaskWithStoreFactory,
    revalidateContinuation,
    selectedContinuation,
});
