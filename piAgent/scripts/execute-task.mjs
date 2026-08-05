import { StringDecoder } from 'node:string_decoder';

import {
    continuationDescriptor,
    createContinuationHandle,
    writeContinuationRecord,
} from './continuation-store.mjs';
import { spawnTaskSandbox } from './task-sandbox.mjs';

const LOG_TAIL_LIMIT = 16 * 1024;
const PI_SESSION_ROOT = '/home/agent/.ploinky/pi-sessions';
const SOUL_MODELS = new Set(['fast', 'plan', 'deep']);
const SOUL_EXTENSION_PATH = '/code/extensions/ploinky-soul.mjs';

function serializeCause(cause, depth = 0) {
    if (!cause || depth >= 4) return undefined;
    if (typeof cause !== 'object') return { message: String(cause) };
    return {
        ...(typeof cause.code === 'string' ? { code: cause.code } : {}),
        ...(typeof cause.message === 'string' ? { message: cause.message } : {}),
        ...(cause.cause ? { cause: serializeCause(cause.cause, depth + 1) } : {}),
    };
}

function createContainerLogStream() {
    return {
        write(message) {
            try {
                process.stderr.write(message);
            } catch {
            }
        },
    };
}

function appendBoundedTail(current, chunk, limit = LOG_TAIL_LIMIT) {
    const currentBytes = Buffer.from(String(current || ''), 'utf8');
    const chunkBytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ''), 'utf8');
    const next = Buffer.concat([currentBytes, chunkBytes]);
    let start = Math.max(0, next.length - limit);
    while (start < next.length && (next[start] & 0xc0) === 0x80) start += 1;
    return next.subarray(start).toString('utf8');
}

function extractTextContent(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(extractTextContent).join('');
    if (!value || typeof value !== 'object') return '';
    if (value.type === 'text' && typeof value.text === 'string') return value.text;
    if ('content' in value) return extractTextContent(value.content);
    return '';
}

function unseenText(previous, next) {
    if (!next) return '';
    if (!previous) return next;
    if (next.startsWith(previous)) return next.slice(previous.length);
    if (previous.endsWith(next)) return '';
    const overlapLimit = Math.min(previous.length, next.length);
    for (let overlap = overlapLimit; overlap > 0; overlap -= 1) {
        if (previous.endsWith(next.slice(0, overlap))) return next.slice(overlap);
    }
    return next;
}

function extractAssistantError(message) {
    if (!message || message.role !== 'assistant' || message.stopReason !== 'error') return '';
    const diagnostics = Array.isArray(message.diagnostics) ? message.diagnostics : [];
    const candidates = [
        message.errorMessage,
        message.error?.message,
        ...diagnostics.map((diagnostic) => diagnostic?.errorMessage),
        ...diagnostics.map((diagnostic) => diagnostic?.error?.message),
    ];
    return candidates
        .find((candidate) => typeof candidate === 'string' && candidate.trim())
        ?.trim() || 'PI assistant stopped with an error.';
}

export function createPiJsonEventParser({ onText = () => {} } = {}) {
    const decoder = new StringDecoder('utf8');
    const toolOutput = new Map();
    let buffered = '';
    let currentAssistantText = '';
    let finalAssistantText = '';
    let assistantError = '';

    const emit = (text) => {
        if (typeof text === 'string' && text) onText(text);
    };
    const processLine = (line) => {
        if (!line.trim()) return;
        let event;
        try {
            event = JSON.parse(line);
        } catch {
            emit(`${line}\n`);
            return;
        }

        if (event?.type === 'message_start' && event.message?.role === 'assistant') {
            currentAssistantText = '';
            return;
        }
        if (event?.type === 'message_update') {
            const update = event.assistantMessageEvent;
            if (update?.type === 'text_delta' && typeof update.delta === 'string') {
                currentAssistantText = appendBoundedTail(currentAssistantText, update.delta);
                emit(update.delta);
            }
            return;
        }
        if (event?.type === 'message_end' && event.message?.role === 'assistant') {
            const completeText = extractTextContent(event.message.content);
            emit(unseenText(currentAssistantText, completeText));
            if (completeText) finalAssistantText = appendBoundedTail('', completeText);
            assistantError ||= extractAssistantError(event.message);
            currentAssistantText = '';
            return;
        }
        if (event?.type === 'tool_execution_update' || event?.type === 'tool_execution_end') {
            const toolCallId = String(event.toolCallId || '');
            const previous = toolOutput.get(toolCallId) || '';
            const value = event.type === 'tool_execution_update'
                ? event.partialResult
                : event.result;
            const completeText = extractTextContent(value);
            const suffix = unseenText(previous, completeText);
            emit(suffix);
            if (event.type === 'tool_execution_end') {
                toolOutput.delete(toolCallId);
            } else {
                toolOutput.set(toolCallId, appendBoundedTail(previous, suffix));
            }
        }
    };
    const consume = (text) => {
        buffered += text;
        let newline = buffered.indexOf('\n');
        while (newline !== -1) {
            const line = buffered.slice(0, newline).replace(/\r$/, '');
            buffered = buffered.slice(newline + 1);
            processLine(line);
            newline = buffered.indexOf('\n');
        }
    };

    return {
        push(chunk) {
            consume(decoder.write(chunk));
        },
        finish() {
            consume(decoder.end());
            if (buffered) processLine(buffered.replace(/\r$/, ''));
            buffered = '';
        },
        getFinalOutputText() {
            return finalAssistantText;
        },
        getErrorMessage() {
            return assistantError;
        },
    };
}

async function collectPiResult(runtime, { logStream }) {
    const startedAt = Date.now();
    const child = runtime?.child;
    if (!child?.stdout || !child?.stderr || !(runtime.completion instanceof Promise)) {
        const error = new Error('PI provider runtime did not return piped output and completion');
        error.code = 'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID';
        throw error;
    }
    let stdoutTail = '';
    let stderrTail = '';
    const jsonEvents = createPiJsonEventParser({
        onText(text) {
            stdoutTail = appendBoundedTail(stdoutTail, text);
            logStream.write(text);
        },
    });
    child.stdout.on('data', (chunk) => jsonEvents.push(chunk));
    child.stderr.on('data', (chunk) => {
        stderrTail = appendBoundedTail(stderrTail, chunk.toString('utf8'));
        logStream.write(chunk);
    });
    let result;
    try {
        result = await runtime.completion;
    } finally {
        jsonEvents.finish();
    }
    return {
        code: result?.code,
        signal: result?.signal,
        durationMs: Date.now() - startedAt,
        stdoutTail,
        stderrTail,
        finalOutputText: jsonEvents.getFinalOutputText(),
        assistantError: jsonEvents.getErrorMessage(),
    };
}

function summarizeFailure(result) {
    return `PI task failed with exit code ${result.code ?? 'unknown'}${result.signal ? ` signal ${result.signal}` : ''}`;
}

function summarizeOutput(result, { preferStderr = false } = {}) {
    const output = preferStderr
        ? (result.stderrTail || result.stdoutTail || '')
        : (result.stdoutTail || result.stderrTail || '');
    return output.trim();
}

function invalidInput(message) {
    const error = new TypeError(message);
    error.code = 'PLOINKY_PROVIDER_INPUT_INVALID';
    return error;
}

function taskInput(payload) {
    const input = payload?.input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw invalidInput('PI task input must be an object');
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
        throw invalidInput('PI task input must be a plain object');
    }
    const values = {};
    const allowed = new Set(['prompt', 'projectDir', 'model']);
    for (const name of Reflect.ownKeys(input)) {
        if (typeof name !== 'string' || !allowed.has(name)) {
            throw invalidInput(`PI task input contains unknown field ${String(name)}`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(input, name);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            throw invalidInput(`PI task input field ${name} must be a data property`);
        }
        values[name] = descriptor.value;
    }
    if (typeof values.prompt !== 'string' || !values.prompt.trim()) {
        throw invalidInput('prompt is required and must be a non-empty string');
    }
    if (typeof values.projectDir !== 'string' || !values.projectDir
        || values.projectDir !== values.projectDir.trim()) {
        throw invalidInput('projectDir is required and must be an exact non-empty string');
    }
    if (values.model !== undefined && typeof values.model !== 'string') {
        throw invalidInput('model must be a string');
    }
    return Object.freeze({
        prompt: values.prompt.trim(),
        workdir: values.projectDir,
        model: typeof values.model === 'string' ? values.model.trim() : '',
    });
}

function piArguments({ prompt, model, handle }) {
    return Object.freeze([
        '--mode',
        'json',
        '--session-id',
        handle,
        '--session-dir',
        `${PI_SESSION_ROOT}/${handle}`,
        '--extension',
        SOUL_EXTENSION_PATH,
        '--provider',
        'ploinky-soul',
        '--model',
        SOUL_MODELS.has(model) ? model : 'fast',
        prompt,
    ]);
}

function canonicalProjectDir(runtime) {
    const workdir = runtime?.launch?.workdir;
    if (typeof workdir !== 'string' || !workdir || workdir.startsWith('/')) {
        const error = new Error('PI provider runtime omitted the validated WORKDIR');
        error.code = 'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID';
        throw error;
    }
    return `/workspace/${workdir}`;
}

function failure(error, continuation) {
    return {
        ok: false,
        error: `PI task failed: ${error?.message || 'unknown error'}`,
        code: error?.code,
        status: error?.status,
        cause: serializeCause(error?.cause),
        ...(continuation ? { continuation } : {}),
    };
}

async function executeProviderTaskWithStore(
    payload,
    { providerRuntime, signal } = {},
    stateStore = { writeContinuationRecord },
) {
    if (!providerRuntime || typeof providerRuntime !== 'object'
        || providerRuntime.provider !== 'pi'
        || providerRuntime.mode !== 'task'
        || typeof providerRuntime.spawnWith !== 'function') {
        return failure(Object.assign(
            new Error('PI task requires the trusted provider runtime'),
            { code: 'PLOINKY_PROVIDER_RUNTIME_REQUIRED' },
        ));
    }
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
        return failure(invalidInput('PI task signal must be an AbortSignal'));
    }
    let input;
    try {
        input = taskInput(payload);
    } catch (error) {
        return failure(error);
    }

    const handle = createContinuationHandle();
    const args = piArguments({ ...input, handle });
    const model = args[args.indexOf('--model') + 1];
    const environment = Object.freeze({
        PLOINKY_PROVIDER_MODEL: model,
        PLOINKY_PROVIDER_SESSION_ID: handle,
    });
    let continuation = null;
    let record = null;
    const persistContinuation = (launch) => {
        const projectDir = canonicalProjectDir({ launch });
        record = stateStore.writeContinuationRecord(handle, {
            projectDir,
            ...(record?.createdAt ? { createdAt: record.createdAt } : {}),
        });
        continuation = continuationDescriptor(handle);
        return Object.freeze({ projectDir });
    };
    try {
        const runtime = await providerRuntime.spawnWith(
            spawnTaskSandbox,
            { workdir: input.workdir, args },
            {
                afterExit: ({ launch }) => persistContinuation(launch),
                environment,
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        );
        const result = await collectPiResult(runtime, { logStream: createContainerLogStream() });
        if (!record || !continuation) {
            const error = new Error('PI provider runtime released its HOME lease without persisting continuation state');
            error.code = 'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID';
            throw error;
        }
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
        return failure(error, continuation);
    }
}

export function executeProviderTask(payload, context) {
    return executeProviderTaskWithStore(payload, context);
}

export {
    collectPiResult,
    createContainerLogStream,
    failure as piTaskFailure,
    piArguments,
    summarizeFailure,
    summarizeOutput,
};

export const __testables = Object.freeze({
    PI_SESSION_ROOT,
    SOUL_EXTENSION_PATH,
    appendBoundedTail,
    collectPiResult,
    executeProviderTaskWithStore,
    piArguments,
    taskInput,
});
