import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const DEFAULT_CODEX_BIN = '/usr/local/bin/codex';
export const CODEX_TIMEOUT_MS = 300000;

const LOG_TAIL_LIMIT = 16 * 1024;

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
    return fs.existsSync(DEFAULT_CODEX_BIN) ? DEFAULT_CODEX_BIN : 'codex';
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
    if (threadId) {
        return [
            'exec',
            'resume',
            '--json',
            '--skip-git-repo-check',
            '--dangerously-bypass-approvals-and-sandbox',
            threadId,
            prompt,
        ];
    }
    return [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--dangerously-bypass-approvals-and-sandbox',
        ...(model ? ['--model', model] : []),
        prompt,
    ];
}

export function runCodex({
    projectDir,
    prompt,
    model = '',
    threadId = '',
    logStream = createContainerLogStream(),
    env = process.env,
}) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const args = buildCodexArgs({ prompt, model, threadId });
        const child = spawn(resolveCodexBinary(env), args, {
            cwd: projectDir,
            env: {
                ...process.env,
                ...env,
                HOME: '/root',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdoutTail = '';
        let stderrTail = '';
        let jsonBuffer = '';
        let resolvedThreadId = threadId;
        let outputText = '';
        let visibleTextTail = '';
        let timedOut = false;

        function consumeLine(rawLine, complete = true) {
            const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
            if (!line.trim()) return;
            try {
                const event = JSON.parse(line);
                resolvedThreadId = eventThreadId(event) || resolvedThreadId;
                const agentMessage = eventAgentMessage(event);
                outputText = agentMessage
                    ? appendBoundedTail('', agentMessage)
                    : outputText;
                const liveText = eventLogText(event);
                if (liveText) {
                    visibleTextTail = appendBoundedTail(visibleTextTail, liveText);
                    logStream.write(liveText);
                }
            } catch {
                logStream.write(`${line}${complete ? '\n' : ''}`);
            }
        }

        const timeout = setTimeout(() => {
            timedOut = true;
            try {
                child.kill('SIGTERM');
            } catch {
            }
        }, CODEX_TIMEOUT_MS);

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
        child.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        child.on('close', (code, signal) => {
            clearTimeout(timeout);
            if (jsonBuffer) consumeLine(jsonBuffer, false);
            resolve({
                code,
                signal,
                timedOut,
                durationMs: Date.now() - startedAt,
                stdoutTail,
                stderrTail,
                threadId: resolvedThreadId,
                outputText: outputText.trim(),
                visibleTextTail,
            });
        });
    });
}

export function summarizeFailure(result) {
    return result.timedOut
        ? `Codex task timed out after ${CODEX_TIMEOUT_MS / 1000}s`
        : `Codex task failed with exit code ${result.code ?? 'unknown'}${result.signal ? ` signal ${result.signal}` : ''}`;
}

export async function executeCodexTask({
    prompt,
    projectDir,
    model = '',
    threadId = '',
    logStream = createContainerLogStream(),
    env = process.env,
}) {
    const taskPrompt = String(prompt || '').trim();
    const resolvedProjectDir = path.resolve(String(projectDir || '').trim());
    const resolvedModel = String(model || '').trim();
    const resolvedThreadId = String(threadId || '').trim();

    try {
        const result = await runCodex({
            projectDir: resolvedProjectDir,
            prompt: taskPrompt,
            model: resolvedModel,
            threadId: resolvedThreadId,
            logStream,
            env,
        });
        const outputText = result.outputText
            || (result.stderrTail || '').trim()
            || (result.visibleTextTail || '').trim();
        if (result.timedOut || result.code !== 0) {
            return {
                ok: false,
                error: summarizeFailure(result),
                outputText,
                threadId: result.threadId,
                projectDir: resolvedProjectDir,
            };
        }
        return {
            ok: true,
            outputText,
            threadId: result.threadId,
            projectDir: resolvedProjectDir,
        };
    } catch (error) {
        return {
            ok: false,
            error: `Codex task failed: ${error?.message || 'unknown error'}`,
            outputText: '',
            threadId: resolvedThreadId,
            projectDir: resolvedProjectDir,
        };
    }
}

export const __testables = { appendBoundedTail, eventThreadId, eventAgentMessage };
