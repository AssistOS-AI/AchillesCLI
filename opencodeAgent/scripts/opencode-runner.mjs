import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { startScopedSoulBroker } from './scoped-soul-broker.mjs';
import {
    buildTaskSandboxLaunch,
    prepareTaskSandbox,
} from './task-sandbox.mjs';
const DEFAULT_OPENCODE_HOME = '/root';
const LOG_TAIL_LIMIT = 16 * 1024;
const CONTROL_OUTPUT_LIMIT = 1024 * 1024;
const SEMANTIC_FAILURE_PATTERNS = [
    /permission requested:\s*external_directory/i,
    /auto-rejecting/i,
    /the user rejected permission/i,
    /read \. failed/i,
];
const SOUL_MODELS = new Set(['fast', 'plan', 'deep']);

function serializeCause(cause, depth = 0) {
    if (!cause || depth >= 4) return undefined;
    if (typeof cause !== 'object') return { message: String(cause) };
    return {
        ...(typeof cause.code === 'string' ? { code: cause.code } : {}),
        ...(typeof cause.message === 'string' ? { message: cause.message } : {}),
        ...(cause.cause ? { cause: serializeCause(cause.cause, depth + 1) } : {}),
    };
}

export function resolveOpenCodeBin(env = process.env) {
    const home = String(env.HOME || DEFAULT_OPENCODE_HOME);
    return path.join(home, '.opencode', 'bin', 'opencode');
}

export const DEFAULT_OPENCODE_BIN = resolveOpenCodeBin();

function existingPaths(candidates) {
    return candidates.filter((candidate) => candidate && fsSync.existsSync(candidate));
}

function spawnSandboxedOpenCode({
    opencodeBin,
    args,
    projectDir,
    env,
    stdio = ['ignore', 'pipe', 'pipe'],
    sandboxDependencies,
}) {
    const childEnv = {
        ...process.env,
        ...env,
        HOME: '/root',
    };
    const launch = buildTaskSandboxLaunch({
        projectDir,
        command: opencodeBin,
        args,
        env: childEnv,
        readOnlyPaths: existingPaths([
            '/root/.opencode',
        ]),
        writablePaths: existingPaths([
            '/root/.config/opencode',
            '/root/.cache/opencode',
            '/root/.local/share/opencode',
            '/root/.local/state/opencode',
        ]),
        dependencies: sandboxDependencies,
    });
    return spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        env: childEnv,
        stdio,
    });
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

export function logLine(logStream, message) {
    logStream.write(`${message}\n`);
}

function appendBoundedTail(current, chunk, limit = LOG_TAIL_LIMIT) {
    const next = Buffer.concat([
        Buffer.from(String(current || ''), 'utf8'),
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ''), 'utf8'),
    ]);
    let start = Math.max(0, next.length - limit);
    while (start < next.length && (next[start] & 0xc0) === 0x80) start += 1;
    return next.subarray(start).toString('utf8');
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

function listOpenCodeSessions({ opencodeBin, projectDir, env, sandboxDependencies }) {
    return new Promise((resolve, reject) => {
        const child = spawnSandboxedOpenCode({
            opencodeBin,
            args: [
                'session',
                'list',
                '--format',
                'json',
                '--max-count',
                '1000',
            ],
            projectDir,
            env,
            sandboxDependencies,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout = appendBoundedTail(stdout, chunk, CONTROL_OUTPUT_LIMIT);
        });
        child.stderr.on('data', (chunk) => {
            stderr = appendBoundedTail(stderr, chunk, LOG_TAIL_LIMIT);
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(stderr.trim()
                    || `Unable to list OpenCode sessions (exit ${code}).`));
                return;
            }
            try {
                resolve(JSON.parse(stdout));
            } catch {
                reject(new Error('OpenCode returned an invalid session list.'));
            }
        });
    });
}

async function findSessionId({ opencodeBin, projectDir, env, title, sandboxDependencies }) {
    const sessions = await listOpenCodeSessions({
        opencodeBin,
        projectDir,
        env,
        sandboxDependencies,
    });
    if (!Array.isArray(sessions)) return '';
    const expectedDirectory = path.resolve(projectDir);
    const match = sessions.find((session) => (
        session?.title === title
        && path.resolve(String(session?.directory || '')) === expectedDirectory
    ));
    return String(match?.id || '').trim();
}

export async function findSessionIdFromDatabase({ projectDir, env, title }) {
    const dataRoot = String(env.XDG_DATA_HOME || '').trim()
        || path.join(String(env.HOME || DEFAULT_OPENCODE_HOME), '.local', 'share');
    const databasePath = path.join(dataRoot, 'opencode', 'opencode.db');
    let expectedDirectory = path.resolve(projectDir);
    try {
        expectedDirectory = fsSync.realpathSync(expectedDirectory);
    } catch {
    }
    try {
        const { DatabaseSync } = await import('node:sqlite');
        const database = new DatabaseSync(databasePath, { readOnly: true });
        try {
            const row = database.prepare(`
                SELECT id
                FROM session
                WHERE title = ? AND directory = ?
                ORDER BY time_updated DESC
                LIMIT 1
            `).get(title, expectedDirectory);
            return String(row?.id || '').trim();
        } finally {
            database.close();
        }
    } catch {
        return '';
    }
}

function managedOpenCodeModel(requestedModel) {
    const requested = String(requestedModel || '').trim();
    const [provider, model] = requested.split('/');
    return provider === 'soul' && SOUL_MODELS.has(model)
        ? requested
        : 'soul/fast';
}

function exportSession({ opencodeBin, projectDir, env, sessionId, sandboxDependencies }) {
    return new Promise((resolve, reject) => {
        const child = spawnSandboxedOpenCode({
            opencodeBin,
            args: ['export', sessionId],
            projectDir,
            env,
            sandboxDependencies,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout = appendBoundedTail(stdout, chunk, CONTROL_OUTPUT_LIMIT);
        });
        child.stderr.on('data', (chunk) => {
            stderr = appendBoundedTail(stderr, chunk, LOG_TAIL_LIMIT);
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(stderr.trim()
                    || `Unable to export OpenCode session (exit ${code}).`));
                return;
            }
            const raw = stdout;
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

async function finalSessionText({
    opencodeBin,
    projectDir,
    env,
    sessionId,
    sandboxDependencies,
}) {
    const exported = await exportSession({
        opencodeBin,
        projectDir,
        env,
        sessionId,
        sandboxDependencies,
    });
    const messages = Array.isArray(exported?.messages) ? exported.messages : [];
    const assistant = messages.findLast((message) => message?.info?.role === 'assistant');
    if (!assistant || !Array.isArray(assistant.parts)) return '';
    return appendBoundedTail('', assistant.parts
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join(''));
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
    sandboxDependencies,
}) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const args = [
            'run',
            '--auto',
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

        const child = spawnSandboxedOpenCode({
            opencodeBin,
            args,
            projectDir,
            env,
            sandboxDependencies,
        });
        const abort = () => {
            try { child.kill('SIGTERM'); } catch (_) { }
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener?.('abort', abort, { once: true });

        let stdoutTail = '';
        let stderrTail = '';

        child.stdout.on('data', (chunk) => {
            stdoutTail = appendBoundedTail(stdoutTail, chunk);
            logStream.write(chunk);
        });

        child.stderr.on('data', (chunk) => {
            stderrTail = appendBoundedTail(stderrTail, chunk);
            logStream.write(chunk);
        });

        child.on('error', (error) => {
            signal?.removeEventListener?.('abort', abort);
            reject(error);
        });

        child.on('close', async (code, closeSignal) => {
            signal?.removeEventListener?.('abort', abort);
            let resolvedSessionId = sessionId;
            let sessionLookupError = '';
            if (sessionTitle) {
                try {
                    resolvedSessionId = await findSessionId({
                        opencodeBin,
                        projectDir,
                        env,
                        title: sessionTitle,
                        sandboxDependencies,
                    });
                } catch (error) {
                    sessionLookupError = error?.message || String(error);
                    resolvedSessionId = await findSessionIdFromDatabase({
                        projectDir,
                        env,
                        title: sessionTitle,
                    });
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
                        sandboxDependencies,
                    }) || stdoutTail;
                } catch {
                    outputText = stdoutTail;
                }
            }
            resolve({
                code,
                signal: closeSignal,
                durationMs: Date.now() - startedAt,
                stdoutTail,
                stderrTail,
                sessionId: resolvedSessionId,
                sessionLookupError,
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
    return `OpenCode task failed with exit code ${result.code ?? 'unknown'}${result.signal ? ` signal ${result.signal}` : ''}`;
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
    sandboxDependencies,
}) {
    const resolvedProjectDir = path.resolve(projectDir);
    let effectiveProjectDir = resolvedProjectDir;
    const resolvedModel = typeof model === 'string' ? model.trim() : '';
    const resolvedVariant = typeof variant === 'string' ? variant.trim() : '';
    const taskPrompt = String(prompt || '').trim();

    try {
        const prepared = prepareTaskSandbox({
            projectDir: resolvedProjectDir,
            env,
            createProjectDir,
            dependencies: sandboxDependencies,
        });
        effectiveProjectDir = prepared.projectDir;
    } catch (error) {
        return {
            ok: false,
            code: error?.code,
            status: error?.status,
            cause: serializeCause(error?.cause),
            error: error?.message || String(error),
            projectDir: resolvedProjectDir,
            effectiveProjectDir,
            model: resolvedModel,
        };
    }

    let broker = null;
    try {
        broker = await startScopedSoulBroker(env);
        const taskEnv = broker
            ? { ...env, ...broker.environment }
            : env;
        const effectiveModel = broker
            ? managedOpenCodeModel(resolvedModel)
            : resolvedModel;
        const result = await runOpenCode({
            projectDir: effectiveProjectDir,
            model: effectiveModel,
            variant: resolvedVariant,
            prompt: taskPrompt,
            sessionId,
            captureSession,
            logStream,
            env: taskEnv,
            opencodeBin: env.OPENCODE_BIN || resolveOpenCodeBin(env),
            signal,
            sandboxDependencies,
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
                model: effectiveModel,
                sessionId: result.sessionId || sessionId,
            };
        }

        if (captureSession && !result.sessionId) {
            return {
                ok: false,
                error: result.sessionLookupError
                    ? `OpenCode completed, but its session could not be recovered: ${result.sessionLookupError}`
                    : 'OpenCode completed, but did not persist a resumable session.',
                outputText,
                projectDir: resolvedProjectDir,
                effectiveProjectDir,
                model: effectiveModel,
                sessionId: '',
            };
        }

        return {
            ok: true,
            outputText,
            projectDir: resolvedProjectDir,
            effectiveProjectDir,
            model: effectiveModel,
            sessionId: result.sessionId || sessionId,
        };
    } catch (error) {
        return {
            ok: false,
            code: error?.code,
            status: error?.status,
            cause: serializeCause(error?.cause),
            error: `OpenCode task failed: ${error.message}`,
            projectDir: resolvedProjectDir,
            effectiveProjectDir,
            model: resolvedModel,
        };
    } finally {
        await broker?.close();
    }
}

export const __testables = {
    CONTROL_OUTPUT_LIMIT,
    LOG_TAIL_LIMIT,
    appendBoundedTail,
};
