import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

export const OPENCODE_TIMEOUT_MS = 300000;

const DEFAULT_OPENCODE_HOME = '/root';
const LOG_TAIL_LIMIT = 16 * 1024;
const SEMANTIC_FAILURE_PATTERNS = [
    /permission requested:\s*external_directory/i,
    /auto-rejecting/i,
    /the user rejected permission/i,
    /read \. failed/i,
];

export function resolveOpenCodeBin(env = process.env) {
    const home = String(env.HOME || DEFAULT_OPENCODE_HOME);
    return path.join(home, '.opencode', 'bin', 'opencode');
}

export const DEFAULT_OPENCODE_BIN = resolveOpenCodeBin();

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

export function logLine(logStream, message) {
    logStream.write(`${message}\n`);
}

function appendBoundedTail(current, chunk, limit = LOG_TAIL_LIMIT) {
    const next = `${current}${chunk}`;
    if (next.length <= limit) {
        return next;
    }
    return next.slice(next.length - limit);
}

export async function readRecentOpenCodeModel(env = process.env) {
    const stateRoot = String(env.XDG_STATE_HOME || '').trim()
        || path.join(String(env.HOME || DEFAULT_OPENCODE_HOME), '.local', 'state');
    try {
        const state = JSON.parse(await fs.readFile(
            path.join(stateRoot, 'opencode', 'model.json'),
            'utf8',
        ));
        const recent = state?.recent?.[0];
        const providerID = typeof recent?.providerID === 'string'
            ? recent.providerID.trim()
            : '';
        const modelID = typeof recent?.modelID === 'string'
            ? recent.modelID.trim()
            : '';
        if (!providerID || !modelID) return { model: '', variant: '' };
        const model = `${providerID}/${modelID}`;
        const storedVariant = typeof state?.variant?.[model] === 'string'
            ? state.variant[model].trim()
            : '';
        return {
            model,
            variant: storedVariant && storedVariant !== 'default' ? storedVariant : '',
        };
    } catch {
        return { model: '', variant: '' };
    }
}

function listOpenCodeSessions({ opencodeBin, projectDir, env }) {
    return new Promise((resolve, reject) => {
        const child = spawn(opencodeBin, [
            'session',
            'list',
            '--format',
            'json',
            '--max-count',
            '1000',
        ], {
            cwd: projectDir,
            env: {
                ...process.env,
                ...env,
                HOME: '/root',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const stdout = [];
        const stderr = [];
        child.stdout.on('data', (chunk) => stdout.push(chunk));
        child.stderr.on('data', (chunk) => stderr.push(chunk));
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(Buffer.concat(stderr).toString('utf8').trim()
                    || `Unable to list OpenCode sessions (exit ${code}).`));
                return;
            }
            try {
                resolve(JSON.parse(Buffer.concat(stdout).toString('utf8')));
            } catch {
                reject(new Error('OpenCode returned an invalid session list.'));
            }
        });
    });
}

async function findSessionId({ opencodeBin, projectDir, env, title }) {
    const sessions = await listOpenCodeSessions({ opencodeBin, projectDir, env });
    if (!Array.isArray(sessions)) return '';
    const expectedDirectory = path.resolve(projectDir);
    const match = sessions.find((session) => (
        session?.title === title
        && path.resolve(String(session?.directory || '')) === expectedDirectory
    ));
    return String(match?.id || '').trim();
}

function exportSession({ opencodeBin, projectDir, env, sessionId }) {
    return new Promise((resolve, reject) => {
        const child = spawn(opencodeBin, ['export', sessionId], {
            cwd: projectDir,
            env: {
                ...process.env,
                ...env,
                HOME: '/root',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const stdout = [];
        const stderr = [];
        child.stdout.on('data', (chunk) => stdout.push(chunk));
        child.stderr.on('data', (chunk) => stderr.push(chunk));
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(Buffer.concat(stderr).toString('utf8').trim()
                    || `Unable to export OpenCode session (exit ${code}).`));
                return;
            }
            const raw = Buffer.concat(stdout).toString('utf8');
            const jsonStart = raw.indexOf('{');
            if (jsonStart < 0) {
                reject(new Error('OpenCode returned an invalid session export.'));
                return;
            }
            try {
                resolve(JSON.parse(raw.slice(jsonStart)));
            } catch {
                reject(new Error('OpenCode returned an invalid session export.'));
            }
        });
    });
}

async function finalSessionText({ opencodeBin, projectDir, env, sessionId }) {
    const exported = await exportSession({ opencodeBin, projectDir, env, sessionId });
    const messages = Array.isArray(exported?.messages) ? exported.messages : [];
    const assistant = messages.findLast((message) => message?.info?.role === 'assistant');
    if (!assistant || !Array.isArray(assistant.parts)) return '';
    return assistant.parts
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('');
}

export function runOpenCode({
    projectDir,
    model,
    variant = '',
    prompt,
    sessionId = '',
    captureSession = false,
    logStream,
    env = process.env,
    opencodeBin = env.OPENCODE_BIN || resolveOpenCodeBin(env),
    signal,
}) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const args = [
            'run',
            '--dangerously-skip-permissions',
        ];
        const sessionTitle = captureSession && !sessionId
            ? `ploinky-task-${randomUUID()}`
            : '';
        args.push('--dir', projectDir);
        if (sessionId) {
            args.push('--session', sessionId);
        }
        if (sessionTitle) {
            args.push('--title', sessionTitle);
        }
        if (model) {
            args.push('--model', model);
        }
        if (variant) {
            args.push('--variant', variant);
        }
        args.push(prompt);

        const child = spawn(opencodeBin, args, {
            cwd: projectDir,
            env: {
                ...process.env,
                ...env,
                HOME: '/root',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const abort = () => {
            try { child.kill('SIGTERM'); } catch (_) { }
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener?.('abort', abort, { once: true });

        let stdoutTail = '';
        let stderrTail = '';
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            logLine(logStream, `OpenCode task timed out after ${OPENCODE_TIMEOUT_MS / 1000}s; sending SIGTERM`);
            try {
                child.kill('SIGTERM');
            } catch {
            }
        }, OPENCODE_TIMEOUT_MS);

        child.stdout.on('data', (chunk) => {
            const text = chunk.toString('utf8');
            stdoutTail = appendBoundedTail(stdoutTail, text);
            logStream.write(chunk);
        });

        child.stderr.on('data', (chunk) => {
            const text = chunk.toString('utf8');
            stderrTail = appendBoundedTail(stderrTail, text);
            logStream.write(chunk);
        });

        child.on('error', (error) => {
            clearTimeout(timeout);
            signal?.removeEventListener?.('abort', abort);
            reject(error);
        });

        child.on('close', async (code, closeSignal) => {
            clearTimeout(timeout);
            signal?.removeEventListener?.('abort', abort);
            let resolvedSessionId = sessionId;
            if (sessionTitle) {
                try {
                    resolvedSessionId = await findSessionId({
                        opencodeBin,
                        projectDir,
                        env,
                        title: sessionTitle,
                    });
                } catch (error) {
                    reject(error);
                    return;
                }
            }
            let outputText = stdoutTail;
            if (resolvedSessionId) {
                try {
                    outputText = await finalSessionText({
                        opencodeBin,
                        projectDir,
                        env,
                        sessionId: resolvedSessionId,
                    }) || stdoutTail;
                } catch {
                    outputText = stdoutTail;
                }
            }
            resolve({
                code,
                signal: closeSignal,
                timedOut,
                durationMs: Date.now() - startedAt,
                stdoutTail,
                stderrTail,
                sessionId: resolvedSessionId,
                outputText,
            });
        });
    });
}

export function detectSemanticFailure(result) {
    const combinedOutput = `${result.stderrTail || ''}\n${result.stdoutTail || ''}`;
    return SEMANTIC_FAILURE_PATTERNS.some((pattern) => pattern.test(combinedOutput));
}

export function summarizeFailure(result) {
    return result.timedOut
        ? `OpenCode task timed out after ${OPENCODE_TIMEOUT_MS / 1000}s`
        : `OpenCode task failed with exit code ${result.code ?? 'unknown'}${result.signal ? ` signal ${result.signal}` : ''}`;
}

export function summarizeOutput(result, { preferStderr = false } = {}) {
    return (preferStderr
        ? (result.stderrTail || result.stdoutTail || '')
        : (result.stdoutTail || result.stderrTail || '')
    ).trim();
}

export async function executeOpenCodeTask({
    prompt,
    projectDir,
    model = '',
    variant = '',
    sessionId = '',
    captureSession = false,
    logStream = createContainerLogStream(),
    env = process.env,
    createProjectDir = true,
    signal,
}) {
    const resolvedProjectDir = path.resolve(projectDir);
    const effectiveProjectDir = resolvedProjectDir;
    const resolvedModel = typeof model === 'string' ? model.trim() : '';
    const resolvedVariant = typeof variant === 'string' ? variant.trim() : '';
    const taskPrompt = String(prompt || '').trim();

    if (createProjectDir) {
        try {
            await fs.mkdir(effectiveProjectDir, { recursive: true });
        } catch (error) {
            return {
                ok: false,
                error: `Failed to create project directory: ${error.message}`,
                projectDir: resolvedProjectDir,
                effectiveProjectDir,
                model: resolvedModel,
            };
        }
    }

    try {
        const result = await runOpenCode({
            projectDir: effectiveProjectDir,
            model: resolvedModel,
            variant: resolvedVariant,
            prompt: taskPrompt,
            sessionId,
            captureSession,
            logStream,
            env,
            opencodeBin: env.OPENCODE_BIN || resolveOpenCodeBin(env),
            signal,
        });

        const semanticFailure = detectSemanticFailure(result);
        const outputText = result.outputText
            || summarizeOutput(result, { preferStderr: result.code !== 0 || semanticFailure });
        if (result.code !== 0 || semanticFailure) {
            return {
                ok: false,
                error: semanticFailure
                    ? `OpenCode task failed despite exit code ${result.code ?? 'unknown'}.`
                    : summarizeFailure(result),
                outputText,
                projectDir: resolvedProjectDir,
                effectiveProjectDir,
                model: resolvedModel,
                sessionId: result.sessionId || sessionId,
            };
        }

        return {
            ok: true,
            outputText,
            projectDir: resolvedProjectDir,
            effectiveProjectDir,
            model: resolvedModel,
            sessionId: result.sessionId || sessionId,
        };
    } catch (error) {
        return {
            ok: false,
            error: `OpenCode task failed: ${error.message}`,
            projectDir: resolvedProjectDir,
            effectiveProjectDir,
            model: resolvedModel,
        };
    }
}
