#!/usr/bin/env node

import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';

const PI_BIN_CANDIDATES = ['/usr/local/bin/pi'];
const PI_TIMEOUT_MS = 300000;
const LOG_TAIL_LIMIT = 16 * 1024;

function resolvePiBinary(env = process.env) {
    if (typeof env.PI_BIN === 'string' && env.PI_BIN.trim()) return env.PI_BIN.trim();
    for (const candidate of PI_BIN_CANDIDATES) {
        if (candidate.includes('/') && fs.existsSync(candidate)) return candidate;
        try {
            const resolved = execFileSync('sh', ['-c', `command -v "$1"`, 'sh', candidate], {
                stdio: ['ignore', 'pipe', 'ignore'],
                encoding: 'utf8',
            }).trim();
            if (resolved) return resolved;
        } catch {
        }
    }
    return 'pi';
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
    const next = `${current}${chunk}`;
    return next.length <= limit ? next : next.slice(next.length - limit);
}

function runPi({ projectDir, model, prompt, logStream, env = process.env }) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const args = [
            '-p',
            '--no-session',
            ...(model ? ['--model', model] : []),
            prompt,
        ];
        const child = spawn(resolvePiBinary(env), args, {
            cwd: projectDir,
            env: {
                ...process.env,
                ...env,
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
        const timeout = setTimeout(() => {
            timedOut = true;
            logStream.write(`PI task timed out after ${PI_TIMEOUT_MS / 1000}s; sending SIGTERM\n`);
            try {
                child.kill('SIGTERM');
            } catch {
            }
        }, PI_TIMEOUT_MS);

        child.stdout.on('data', (chunk) => {
            stdoutTail = appendBoundedTail(stdoutTail, chunk.toString('utf8'));
            logStream.write(chunk);
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
    return result.timedOut
        ? `PI task timed out after ${PI_TIMEOUT_MS / 1000}s`
        : `PI task failed with exit code ${result.code ?? 'unknown'}${result.signal ? ` signal ${result.signal}` : ''}`;
}

function summarizeOutput(result, { preferStderr = false } = {}) {
    const output = preferStderr
        ? (result.stderrTail || result.stdoutTail || '')
        : (result.stdoutTail || result.stderrTail || '');
    return output.trim();
}

function parseInput(raw) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) return null;
    try {
        const parsed = JSON.parse(trimmed);
        return parsed.input && typeof parsed.input === 'object' ? parsed.input : parsed;
    } catch {
        return null;
    }
}

async function readStdin() {
    if (process.stdin.isTTY) return '';
    process.stdin.setEncoding('utf8');
    let data = '';
    for await (const chunk of process.stdin) data += chunk;
    return data;
}

export async function executeTask({ prompt, projectDir, model } = {}) {
    const logStream = createContainerLogStream();
    if (typeof prompt !== 'string' || !prompt.trim()) {
        process.stderr.write('prompt is required and must be a non-empty string.\n');
        process.exitCode = 1;
        return;
    }
    if (typeof projectDir !== 'string' || !projectDir.trim()) {
        process.stderr.write('projectDir is required and must be a non-empty string.\n');
        process.exitCode = 1;
        return;
    }

    const resolvedModel = typeof model === 'string' ? model.trim() : '';
    try {
        const result = await runPi({
            projectDir: projectDir.trim(),
            model: resolvedModel,
            prompt: prompt.trim(),
            logStream,
        });
        if (result.timedOut || result.code !== 0) {
            process.stderr.write(`${summarizeFailure(result)}\n`);
            process.exitCode = 1;
            return;
        }
        process.stdout.write(summarizeOutput(result));
    } catch (error) {
        process.stderr.write(`PI task failed: ${error?.message || 'unknown error'}\n`);
        process.exitCode = 1;
    }
}

try {
    const input = parseInput(await readStdin());
    if (!input) {
        process.stderr.write('Invalid or missing input. Expected JSON with prompt and projectDir.\n');
        process.exitCode = 1;
    } else {
        await executeTask(input);
    }
} catch (error) {
    process.stderr.write(`PI task failed: ${error?.message || 'unknown error'}\n`);
    process.exitCode = 1;
}
