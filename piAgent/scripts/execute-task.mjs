#!/usr/bin/env node

import fs from 'node:fs';
import { execSync, spawn } from 'node:child_process';

const PI_BIN_CANDIDATES = [
    '/usr/local/bin/pi',
];

function resolvePiBinary() {
    for (const candidate of PI_BIN_CANDIDATES) {
        if (!candidate) {
            continue;
        }
        if (candidate.includes('/') && fs.existsSync(candidate)) {
            return candidate;
        }
        try {
            const which = execSync(`command -v ${candidate}`, {
                stdio: ['ignore', 'pipe', 'ignore'],
                encoding: 'utf8',
            }).trim();
            if (which) {
                return which;
            }
        } catch {
            // try next candidate
        }
    }
    return 'pi';
}

const PI_BIN = resolvePiBinary();
const PI_TIMEOUT_MS = 300000;
const LOG_TAIL_LIMIT = 16 * 1024;

function createContainerLogStream() {
    const containerStderr = '/proc/1/fd/2';
    return {
        write(message) {
            try {
                process.stderr.write(message);
            } catch {
            }
            try {
                fs.writeFileSync(containerStderr, message);
            } catch {
            }
        },
    };
}

function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function logLine(logStream, message) {
    logStream.write(`${message}\n`);
}

function appendBoundedTail(current, chunk, limit = LOG_TAIL_LIMIT) {
    const next = `${current}${chunk}`;
    if (next.length <= limit) {
        return next;
    }
    return next.slice(next.length - limit);
}

function streamChunkWithPrefix(logStream, prefix, chunk, state) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk ?? '');
    state.buffer += text;
    const lines = state.buffer.split(/\r?\n/);
    state.buffer = lines.pop() ?? '';
    for (const line of lines) {
        logLine(logStream, `${prefix}${line}`);
    }
}

function flushPrefixedBuffer(logStream, prefix, state) {
    if (!state.buffer) {
        return;
    }
    logLine(logStream, `${prefix}${state.buffer}`);
    state.buffer = '';
}

function runPi({ projectDir, model, prompt, logStream }) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const args = [
            '-p',
            '--no-session',
            ...(model ? ['--model', model] : []),
            prompt,
        ];

        const child = spawn(PI_BIN, args, {
            cwd: projectDir,
            env: {
                ...process.env,
                HOME: '/root',
                PI_CODING_AGENT_DIR: '/code',
                PI_OFFLINE: '1',
                PI_SKIP_VERSION_CHECK: '1',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdoutTail = '';
        let stderrTail = '';
        let timedOut = false;
        const stdoutState = { buffer: '' };
        const stderrState = { buffer: '' };
        const timeout = setTimeout(() => {
            timedOut = true;
            logLine(logStream, `[piAgent/execute-task] timeout after ${PI_TIMEOUT_MS / 1000}s; sending SIGTERM`);
            try {
                child.kill('SIGTERM');
            } catch {
            }
        }, PI_TIMEOUT_MS);

        child.stdout.on('data', (chunk) => {
            const text = chunk.toString('utf8');
            stdoutTail = appendBoundedTail(stdoutTail, text);
            streamChunkWithPrefix(logStream, '[pi stdout] ', chunk, stdoutState);
        });

        child.stderr.on('data', (chunk) => {
            const text = chunk.toString('utf8');
            stderrTail = appendBoundedTail(stderrTail, text);
            streamChunkWithPrefix(logStream, '[pi stderr] ', chunk, stderrState);
        });

        child.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });

        child.on('close', (code, signal) => {
            clearTimeout(timeout);
            flushPrefixedBuffer(logStream, '[pi stdout] ', stdoutState);
            flushPrefixedBuffer(logStream, '[pi stderr] ', stderrState);
            resolve({
                code,
                signal,
                timedOut,
                durationMs: Date.now() - startedAt,
                stdoutTail,
                stderrTail,
            });
        });
    });
}

function summarizeFailure(result) {
    const tail = (result.stderrTail || result.stdoutTail || '').trim();
    const base = result.timedOut
        ? `PI task timed out after ${PI_TIMEOUT_MS / 1000}s`
        : `PI task failed with exit code ${result.code ?? 'unknown'}${result.signal ? ` signal ${result.signal}` : ''}`;
    return tail ? `${base}. Output tail:\n${tail}` : base;
}

function summarizeOutput(result, { preferStderr = false } = {}) {
    const source = preferStderr
        ? (result.stderrTail || result.stdoutTail || '')
        : (result.stdoutTail || result.stderrTail || '');
    return source.trim();
}

function parseInput(raw) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) {
        return null;
    }
    try {
        const parsed = JSON.parse(trimmed);
        return parsed.input && typeof parsed.input === 'object' ? parsed.input : parsed;
    } catch {
        return null;
    }
}

async function readStdin() {
    if (process.stdin.isTTY) {
        return '';
    }
    process.stdin.setEncoding('utf8');
    let data = '';
    for await (const chunk of process.stdin) {
        data += chunk;
    }
    return data;
}

export async function executeTask({ prompt, projectDir, model } = {}) {
    const logStream = createContainerLogStream();

    if (typeof prompt !== 'string' || !prompt.trim()) {
        process.stdout.write(JSON.stringify({ ok: false, error: 'prompt is required and must be a non-empty string.' }));
        process.exitCode = 1;
        return;
    }

    if (!projectDir || typeof projectDir !== 'string' || !projectDir.trim()) {
        process.stdout.write(JSON.stringify({ ok: false, error: 'projectDir is required and must be a non-empty string.' }));
        process.exitCode = 1;
        return;
    }

    const resolvedModel = typeof model === 'string' ? model.trim() : '';
    const startedAt = Date.now();

    logLine(
        logStream,
        `[piAgent/execute-task] start projectDir=${projectDir} model=${JSON.stringify(resolvedModel || '(default)')}`
    );

    try {
        const result = await runPi({
            projectDir,
            model: resolvedModel,
            prompt,
            logStream,
        });
        if (result.timedOut || result.code !== 0) {
            const errorText = summarizeFailure(result);
            logLine(logStream, `[piAgent/execute-task] exit code=${result.code}${result.signal ? ` signal=${result.signal}` : ''}`);
            process.stdout.write(JSON.stringify({
                ok: false,
                error: errorText,
                outputText: summarizeOutput(result, { preferStderr: result.code !== 0 || result.timedOut }),
                projectDir,
                model: resolvedModel,
                durationMs: Date.now() - startedAt,
            }));
            process.exitCode = 1;
            return;
        }

        process.stdout.write(JSON.stringify({
            ok: true,
            outputText: summarizeOutput(result),
            projectDir,
            model: resolvedModel,
            durationMs: Date.now() - startedAt,
        }));
    } catch (error) {
        logLine(logStream, `[piAgent/execute-task] crashed: ${error?.message || 'unknown error'}`);
        process.stdout.write(JSON.stringify({
            ok: false,
            error: error?.message || 'pi execution crashed.',
            outputText: '',
            projectDir,
            model: resolvedModel,
        }));
        process.exitCode = 1;
    }
}

try {
    const input = parseInput(await readStdin());
    await executeTask(input);
} catch (error) {
    process.stdout.write(JSON.stringify({
        ok: false,
        error: error?.message || 'pi execution crashed.',
        outputText: '',
    }));
    process.exitCode = 1;
}
