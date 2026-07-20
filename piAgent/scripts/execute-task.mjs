#!/usr/bin/env node

import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    continuationDescriptor,
    createContinuationHandle,
    sessionDirectory,
    writeContinuationRecord,
} from './continuation-store.mjs';

const PI_BIN_CANDIDATES = ['/usr/local/bin/pi'];
const PI_TIMEOUT_MS = 300000;
const LOG_TAIL_LIMIT = 16 * 1024;
const DEFAULT_PI_HOME = '/root';
const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);

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

function readJsonFile(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return {};
    }
}

export function readCurrentPiModel({ projectDir, env = process.env } = {}) {
    const home = String(env.HOME || DEFAULT_PI_HOME);
    const globalSettings = readJsonFile(path.join(home, '.pi', 'agent', 'settings.json'));
    const projectSettings = typeof projectDir === 'string' && projectDir.trim()
        ? readJsonFile(path.join(path.resolve(projectDir), '.pi', 'settings.json'))
        : {};
    const settings = { ...globalSettings, ...projectSettings };
    const provider = typeof settings.defaultProvider === 'string'
        ? settings.defaultProvider.trim()
        : '';
    const model = typeof settings.defaultModel === 'string'
        ? settings.defaultModel.trim()
        : '';
    if (!provider || !model) return { provider: '', model: '', thinking: '' };
    const thinking = typeof settings.defaultThinkingLevel === 'string'
        && THINKING_LEVELS.has(settings.defaultThinkingLevel.trim())
        ? settings.defaultThinkingLevel.trim()
        : '';
    return { provider, model, thinking };
}

function runPi({
    projectDir,
    provider,
    model,
    thinking,
    prompt,
    sessionId,
    sessionDir,
    logStream,
    env = process.env,
}) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const args = [
            '-p',
            '--session-id',
            sessionId,
            '--session-dir',
            sessionDir,
            ...(provider ? ['--provider', provider] : []),
            ...(model ? ['--model', model] : []),
            ...(thinking ? ['--thinking', thinking] : []),
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

export async function executeTask({
    prompt,
    projectDir,
    provider,
    model,
    thinking,
    sessionId,
    sessionDir: suppliedSessionDir,
} = {}) {
    const logStream = createContainerLogStream();
    if (typeof prompt !== 'string' || !prompt.trim()) {
        return { ok: false, error: 'prompt is required and must be a non-empty string.' };
    }
    if (typeof projectDir !== 'string' || !projectDir.trim()) {
        return { ok: false, error: 'projectDir is required and must be a non-empty string.' };
    }

    const resolvedModel = typeof model === 'string' ? model.trim() : '';
    const resolvedProvider = typeof provider === 'string' ? provider.trim() : '';
    const resolvedThinking = typeof thinking === 'string' && THINKING_LEVELS.has(thinking.trim())
        ? thinking.trim()
        : '';
    const handle = typeof sessionId === 'string' && sessionId.trim()
        ? sessionId.trim()
        : createContinuationHandle();
    const resolvedSessionDir = suppliedSessionDir || sessionDirectory(handle);
    const resolvedProjectDir = path.resolve(projectDir.trim());
    writeContinuationRecord(handle, { projectDir: resolvedProjectDir });
    try {
        const result = await runPi({
            projectDir: resolvedProjectDir,
            provider: resolvedProvider,
            model: resolvedModel,
            thinking: resolvedThinking,
            prompt: prompt.trim(),
            sessionId: handle,
            sessionDir: resolvedSessionDir,
            logStream,
        });
        if (result.timedOut || result.code !== 0) {
            return {
                ok: false,
                error: summarizeFailure(result),
                outputText: summarizeOutput(result, { preferStderr: true }),
                continuation: continuationDescriptor(handle),
            };
        }
        writeContinuationRecord(handle, { projectDir: resolvedProjectDir });
        return {
            ok: true,
            outputText: summarizeOutput(result),
            continuation: continuationDescriptor(handle),
        };
    } catch (error) {
        return {
            ok: false,
            error: `PI task failed: ${error?.message || 'unknown error'}`,
            continuation: continuationDescriptor(handle),
        };
    }
}

async function main() {
    try {
        const input = parseInput(await readStdin());
        if (!input) {
            process.stderr.write('Invalid or missing input. Expected JSON with prompt and projectDir.\n');
            process.exitCode = 1;
            return;
        }
        const result = await executeTask(input);
        if (!result.ok) {
            if (result.continuation) {
                process.stdout.write(JSON.stringify({
                    outputText: result.outputText || '',
                    continuation: result.continuation,
                }));
            }
            process.stderr.write(`${result.error || 'PI task failed.'}\n`);
            process.exitCode = 1;
            return;
        }
        process.stdout.write(JSON.stringify({
            outputText: result.outputText || '',
            continuation: result.continuation,
        }));
    } catch (error) {
        process.stderr.write(`PI task failed: ${error?.message || 'unknown error'}\n`);
        process.exitCode = 1;
    }
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
    await main();
}

export const __testables = { runPi };
