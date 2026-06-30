#!/usr/bin/env node

import fs from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const OPENCODE_BIN = '/root/.opencode/bin/opencode';
const OPENCODE_TIMEOUT_MS = 300000;
const LOG_TAIL_LIMIT = 16 * 1024;
const WEB_ASSIST_HOST_DATA_SUFFIX = path.join('.ploinky', 'agents', 'webAssist', 'data');
const WEB_ASSIST_CONTAINER_DATA_ROOT = process.env.OPENCODE_WEBASSIST_DATA_ROOT || '/webAssist-data';
const SEMANTIC_FAILURE_PATTERNS = [
    /permission requested:\s*external_directory/i,
    /auto-rejecting/i,
    /the user rejected permission/i,
    /read \. failed/i,
];

function createContainerLogStream() {
    const containerStderr = '/proc/1/fd/2';

    return {
        write(message) {
            try {
                process.stderr.write(message);
            } catch {
            }

            try {
                writeFileSync(containerStderr, message);
            } catch {
            }
        },
    };
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

function runOpenCode({ projectDir, model, prompt, logStream }) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const args = [
            'run',
            '--dangerously-skip-permissions',
            '--dir',
            projectDir,
        ];
        if (model) {
            args.push('--model', model);
        }
        args.push(prompt);

        const child = spawn(OPENCODE_BIN, args, {
            cwd: projectDir,
            env: {
                ...process.env,
                HOME: '/root',
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
            logLine(logStream, `[opencodeAgent/execute-task] timeout after ${OPENCODE_TIMEOUT_MS / 1000}s; sending SIGTERM`);
            try {
                child.kill('SIGTERM');
            } catch {
            }
        }, OPENCODE_TIMEOUT_MS);

        child.stdout.on('data', (chunk) => {
            const text = chunk.toString('utf8');
            stdoutTail = appendBoundedTail(stdoutTail, text);
            streamChunkWithPrefix(logStream, '[opencode stdout] ', chunk, stdoutState);
        });

        child.stderr.on('data', (chunk) => {
            const text = chunk.toString('utf8');
            stderrTail = appendBoundedTail(stderrTail, text);
            streamChunkWithPrefix(logStream, '[opencode stderr] ', chunk, stderrState);
        });

        child.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });

        child.on('close', (code, signal) => {
            clearTimeout(timeout);
            flushPrefixedBuffer(logStream, '[opencode stdout] ', stdoutState);
            flushPrefixedBuffer(logStream, '[opencode stderr] ', stderrState);
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

function detectSemanticFailure(result) {
    const combinedOutput = `${result.stderrTail || ''}\n${result.stdoutTail || ''}`;
    return SEMANTIC_FAILURE_PATTERNS.some((pattern) => pattern.test(combinedOutput));
}

function summarizeFailure(result) {
    const tail = (result.stderrTail || result.stdoutTail || '').trim();
    const base = result.timedOut
        ? `OpenCode task timed out after ${OPENCODE_TIMEOUT_MS / 1000}s`
        : `OpenCode task failed with exit code ${result.code ?? 'unknown'}${result.signal ? ` signal ${result.signal}` : ''}`;
    return tail ? `${base}. Output tail:\n${tail}` : base;
}

function summarizeOutput(result, { preferStderr = false } = {}) {
    return (preferStderr
        ? (result.stderrTail || result.stdoutTail || '')
        : (result.stdoutTail || result.stderrTail || '')
    ).trim();
}

function resolveEffectiveProjectDir(projectDir, env = process.env) {
    const resolvedProjectDir = path.resolve(projectDir);
    const workspaceRoot = typeof env.PLOINKY_WORKSPACE_ROOT === 'string' && env.PLOINKY_WORKSPACE_ROOT.trim()
        ? path.resolve(env.PLOINKY_WORKSPACE_ROOT.trim())
        : null;

    if (!workspaceRoot) {
        return resolvedProjectDir;
    }

    const webAssistHostDataRoot = path.join(workspaceRoot, WEB_ASSIST_HOST_DATA_SUFFIX);
    const relativeToWebAssistData = path.relative(webAssistHostDataRoot, resolvedProjectDir);
    if (
        relativeToWebAssistData
        && relativeToWebAssistData !== '..'
        && !relativeToWebAssistData.startsWith(`..${path.sep}`)
        && !path.isAbsolute(relativeToWebAssistData)
    ) {
        return path.join(WEB_ASSIST_CONTAINER_DATA_ROOT, relativeToWebAssistData);
    }

    if (relativeToWebAssistData === '') {
        return WEB_ASSIST_CONTAINER_DATA_ROOT;
    }

    return resolvedProjectDir;
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

async function main() {
    const stdinData = await readStdin();
    const input = parseInput(stdinData);

    if (!input) {
        process.stdout.write(JSON.stringify({
            ok: false,
            error: 'Invalid or missing input. Expected JSON with prompt and projectDir.',
        }));
        process.exitCode = 1;
        return;
    }

    const { prompt, projectDir, model } = input;

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

    const resolvedProjectDir = path.resolve(projectDir.trim());
    const effectiveProjectDir = resolveEffectiveProjectDir(resolvedProjectDir);
    const resolvedModel = typeof model === 'string' ? model.trim() : '';
    const taskPrompt = prompt.trim();

    try {
        await fs.mkdir(effectiveProjectDir, { recursive: true });
    } catch (error) {
        process.stdout.write(JSON.stringify({
            ok: false,
            error: `Failed to create project directory: ${error.message}`,
        }));
        process.exitCode = 1;
        return;
    }

    const logStream = createContainerLogStream();
    const startedAt = Date.now();
    logLine(
        logStream,
        `[opencodeAgent/execute-task] start projectDir=${JSON.stringify(resolvedProjectDir)} effectiveProjectDir=${JSON.stringify(effectiveProjectDir)} model=${JSON.stringify(resolvedModel || '(default)')} promptChars=${taskPrompt.length}`
    );

    try {
        const result = await runOpenCode({
            projectDir: effectiveProjectDir,
            model: resolvedModel,
            prompt: taskPrompt,
            logStream,
        });

        logLine(
            logStream,
            `[opencodeAgent/execute-task] exit code=${result.code ?? 'unknown'} signal=${result.signal || ''} durationMs=${result.durationMs}`
        );

        const semanticFailure = detectSemanticFailure(result);
        const outputText = summarizeOutput(result, { preferStderr: result.code !== 0 || semanticFailure });
        if (result.code !== 0 || semanticFailure) {
            process.stdout.write(JSON.stringify({
                ok: false,
                error: semanticFailure
                    ? `OpenCode task failed despite exit code ${result.code ?? 'unknown'}. Output tail:\n${(result.stderrTail || result.stdoutTail || '').trim()}`
                    : summarizeFailure(result),
                outputText,
                projectDir: resolvedProjectDir,
                effectiveProjectDir,
                model: resolvedModel,
            }));
            process.exitCode = 1;
            return;
        }

        process.stdout.write(JSON.stringify({
            ok: true,
            outputText,
            projectDir: resolvedProjectDir,
            effectiveProjectDir,
            model: resolvedModel,
        }));
    } catch (error) {
        logLine(
            logStream,
            `[opencodeAgent/execute-task] error durationMs=${Date.now() - startedAt} message=${JSON.stringify(error.message || String(error))}`
        );
        process.stdout.write(JSON.stringify({
            ok: false,
                error: `OpenCode task failed: ${error.message}`,
                projectDir: resolvedProjectDir,
                effectiveProjectDir,
                model: resolvedModel,
            }));
        process.exitCode = 1;
    }
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
