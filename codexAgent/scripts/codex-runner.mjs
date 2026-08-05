import path from 'node:path';

import { spawnTaskSandbox } from './task-sandbox.mjs';

export const MANAGED_SOUL_MODEL = 'gpt-5.6-sol';
export const MANAGED_SOUL_PROVIDER = 'ploinky_soul';

const LOG_TAIL_LIMIT = 16 * 1024;

function runtimeError(code, message, options) {
    const error = new Error(message, options);
    error.code = code;
    return error;
}

function serializeCause(cause, depth = 0) {
    if (!cause || depth >= 4) return undefined;
    if (typeof cause !== 'object') return { message: String(cause) };
    return {
        ...(typeof cause.code === 'string' ? { code: cause.code } : {}),
        ...(typeof cause.message === 'string' ? { message: cause.message } : {}),
        ...(cause.cause ? { cause: serializeCause(cause.cause, depth + 1) } : {}),
    };
}

function appendBoundedTail(current, chunk, limit = LOG_TAIL_LIMIT) {
    const next = `${current}${chunk}`;
    return next.length <= limit ? next : next.slice(next.length - limit);
}

export function createContainerLogStream() {
    return {
        write(message) {
            try {
                process.stderr.write(message);
            } catch {
            }
        },
    };
}

export function resolveCodexBinary(env = process.env) {
    const configured = String(env.CODEX_BIN || '').trim();
    if (configured) return configured;
    const home = String(env.HOME || '').trim();
    if (!home) {
        throw runtimeError('PLOINKY_PROVIDER_HOME_REQUIRED', 'Codex requires an explicit runtime HOME');
    }
    return path.join(home, '.local', 'bin', 'codex');
}

function textValue(value) {
    return typeof value === 'string' ? value : '';
}

export function eventLogText(event) {
    if (event?.type === 'item.completed') {
        const item = event.item;
        if (item?.type === 'agent_message') return textValue(item.text);
        if (item?.type === 'command_execution') {
            return textValue(item.aggregated_output)
                || textValue(item.output)
                || textValue(item.stdout);
        }
    }
    if (event?.type === 'error') {
        return textValue(event.message)
            || textValue(event.error?.message)
            || textValue(event.error);
    }
    return '';
}

function eventThreadId(event) {
    if (event?.type !== 'thread.started') return '';
    return textValue(event.thread_id || event.threadId).trim();
}

function eventAgentMessage(event) {
    if (event?.type !== 'item.completed' || event.item?.type !== 'agent_message') return '';
    return textValue(event.item.text);
}

export function buildCodexArgs({ prompt, model = '', threadId = '' }) {
    const taskPrompt = String(prompt || '').trim();
    const effectiveModel = String(model || '').trim();
    const effectiveThreadId = String(threadId || '').trim();
    if (!taskPrompt) {
        throw runtimeError('PLOINKY_PROVIDER_INPUT_INVALID', 'Codex prompt must be non-empty');
    }
    const globalArgs = [
        '--sandbox',
        'workspace-write',
        '--ask-for-approval',
        'never',
    ];
    if (effectiveThreadId) {
        if (effectiveModel) {
            throw runtimeError(
                'PLOINKY_PROVIDER_INPUT_INVALID',
                'Codex continuation cannot override the current model',
            );
        }
        return [
            ...globalArgs,
            'exec',
            'resume',
            '--json',
            '--skip-git-repo-check',
            effectiveThreadId,
            taskPrompt,
        ];
    }
    return [
        ...globalArgs,
        'exec',
        '--json',
        '--skip-git-repo-check',
        ...(effectiveModel ? ['--model', effectiveModel] : []),
        taskPrompt,
    ];
}

function assertProviderRuntime(providerRuntime) {
    if (!providerRuntime || typeof providerRuntime !== 'object'
        || typeof providerRuntime.spawnWith !== 'function') {
        throw runtimeError(
            'PLOINKY_PROVIDER_RUNTIME_REQUIRED',
            'Codex requires an injected canonical providerRuntime capability',
        );
    }
    return providerRuntime;
}

function assertProviderHandle(runtime) {
    if (!runtime || typeof runtime !== 'object'
        || !runtime.child?.stdout || !runtime.child?.stderr
        || !(runtime.completion instanceof Promise)
        || runtime.launch?.helper !== '/usr/local/libexec/ploinky-bwrap-launch'
        || runtime.launch?.provider !== 'codex'
        || runtime.launch?.mode !== 'task'
        || typeof runtime.launch?.cwd !== 'string') {
        throw runtimeError(
            'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID',
            'Codex providerRuntime returned an invalid canonical boundary',
        );
    }
    return runtime;
}

export async function runCodex({
    projectDir,
    prompt,
    model = '',
    threadId = '',
    validateAfterLease,
    afterExit,
    logStream = createContainerLogStream(),
    providerRuntime,
}) {
    if (validateAfterLease !== undefined && typeof validateAfterLease !== 'function') {
        throw runtimeError(
            'PLOINKY_PROVIDER_RUNTIME_INPUT_INVALID',
            'Codex post-lease continuation validator must be a function',
        );
    }
    if (afterExit !== undefined && typeof afterExit !== 'function') {
        throw runtimeError(
            'PLOINKY_PROVIDER_RUNTIME_INPUT_INVALID',
            'Codex after-exit callback must be a function',
        );
    }
    const startedAt = Date.now();
    const args = buildCodexArgs({ prompt, model, threadId });
    let stdoutTail = '';
    let stderrTail = '';
    let jsonBuffer = '';
    let resolvedThreadId = String(threadId || '').trim();
    let outputText = '';
    let visibleTextTail = '';
    let observedChild = null;

    function consumeLine(rawLine, complete = true) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (!line.trim()) return;
        try {
            const event = JSON.parse(line);
            resolvedThreadId = eventThreadId(event) || resolvedThreadId;
            const agentMessage = eventAgentMessage(event);
            outputText = agentMessage ? appendBoundedTail('', agentMessage) : outputText;
            const liveText = eventLogText(event);
            if (liveText) {
                visibleTextTail = appendBoundedTail(visibleTextTail, liveText);
                logStream.write(liveText);
            }
        } catch {
            logStream.write(`${line}${complete ? '\n' : ''}`);
        }
    }

    function flushJsonBuffer() {
        if (jsonBuffer) {
            const remaining = jsonBuffer;
            jsonBuffer = '';
            consumeLine(remaining, false);
        }
    }

    function observeProcess(child) {
        if (!child?.stdout || !child?.stderr) {
            throw runtimeError(
                'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID',
                'Codex provider observer received an invalid canonical child boundary',
            );
        }
        if (observedChild) {
            if (observedChild !== child) {
                throw runtimeError(
                    'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID',
                    'Codex provider observer received multiple child boundaries',
                );
            }
            return;
        }
        observedChild = child;
        child.stdout.on('data', (chunk) => {
            const text = chunk.toString('utf8');
            stdoutTail = appendBoundedTail(stdoutTail, text);
            jsonBuffer += text;
            let newline = jsonBuffer.indexOf('\n');
            while (newline >= 0) {
                consumeLine(jsonBuffer.slice(0, newline));
                jsonBuffer = jsonBuffer.slice(newline + 1);
                newline = jsonBuffer.indexOf('\n');
            }
        });
        child.stderr.on('data', (chunk) => {
            stderrTail = appendBoundedTail(stderrTail, chunk.toString('utf8'));
            logStream.write(chunk);
        });
    }

    const runtime = assertProviderHandle(await assertProviderRuntime(providerRuntime).spawnWith(
        spawnTaskSandbox,
        { workdir: projectDir, args },
        {
            stdio: ['ignore', 'pipe', 'pipe'],
            observeProcess,
            ...(validateAfterLease ? { validateAfterLease } : {}),
            ...(afterExit ? {
                afterExit: async ({ code, signal, launch }) => {
                    flushJsonBuffer();
                    return afterExit(Object.freeze({
                        code,
                        signal,
                        threadId: resolvedThreadId,
                        projectDir: launch.cwd,
                    }));
                },
            } : {}),
        },
    ));
    observeProcess(runtime.child);
    const terminal = await runtime.completion;
    flushJsonBuffer();
    return {
        code: terminal?.code,
        signal: terminal?.signal,
        durationMs: Date.now() - startedAt,
        stdoutTail,
        stderrTail,
        threadId: resolvedThreadId,
        outputText: outputText.trim(),
        visibleTextTail,
        projectDir: runtime.launch.cwd,
    };
}

export function summarizeFailure(result) {
    return `Codex task failed with exit code ${result.code ?? 'unknown'}${result.signal ? ` signal ${result.signal}` : ''}`;
}

export async function executeCodexTask({
    prompt,
    projectDir,
    model = '',
    threadId = '',
    validateAfterLease,
    afterExit,
    logStream = createContainerLogStream(),
    providerRuntime,
}) {
    const taskPrompt = String(prompt || '').trim();
    const selectedProjectDir = String(projectDir || '').trim();
    const resolvedModel = String(model || '').trim();
    const resolvedThreadId = String(threadId || '').trim();
    if (!taskPrompt || !selectedProjectDir) {
        return {
            ok: false,
            error: 'Codex requires non-empty prompt and projectDir values',
            code: 'PLOINKY_PROVIDER_INPUT_INVALID',
            outputText: '',
            threadId: resolvedThreadId,
            projectDir: selectedProjectDir,
        };
    }

    try {
        const result = await runCodex({
            projectDir: selectedProjectDir,
            prompt: taskPrompt,
            model: resolvedModel,
            threadId: resolvedThreadId,
            validateAfterLease,
            afterExit,
            logStream,
            providerRuntime,
        });
        const outputText = result.outputText
            || (result.stderrTail || '').trim()
            || (result.visibleTextTail || '').trim();
        if (result.code !== 0) {
            return {
                ok: false,
                error: summarizeFailure(result),
                code: result.signal === 'SIGTERM'
                    ? 'PLOINKY_PROVIDER_CANCELLED'
                    : 'PLOINKY_PROVIDER_EXIT_FAILED',
                outputText,
                threadId: result.threadId,
                projectDir: result.projectDir,
            };
        }
        return {
            ok: true,
            outputText,
            threadId: result.threadId,
            projectDir: result.projectDir,
        };
    } catch (error) {
        return {
            ok: false,
            error: `Codex task failed: ${error?.message || 'unknown error'}`,
            code: typeof error?.code === 'string' ? error.code : 'PLOINKY_PROVIDER_EXECUTION_FAILED',
            cause: serializeCause(error),
            outputText: '',
            threadId: resolvedThreadId,
            projectDir: selectedProjectDir,
        };
    }
}

export const __testables = Object.freeze({
    appendBoundedTail,
    eventThreadId,
    eventAgentMessage,
    serializeCause,
});
