import { randomUUID } from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { spawnTaskSandbox } from './task-sandbox.mjs';

const DEFAULT_OPENCODE_HOME = '/home/agent';
const LOG_TAIL_LIMIT = 16 * 1024;
const SEMANTIC_FAILURE_PATTERNS = [
    /permission requested:\s*external_directory/i,
    /auto-rejecting/i,
    /the user rejected permission/i,
    /read \. failed/i,
];
const SOUL_MODELS = new Set(['fast', 'plan', 'deep']);
const PROVIDER_ENV_NAMES = Object.freeze([
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TERM',
    'COLORTERM',
    'NO_COLOR',
    'FORCE_COLOR',
    'COLUMNS',
    'LINES',
]);

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

function providerEnvironment(env) {
    const environment = {};
    for (const name of PROVIDER_ENV_NAMES) {
        const value = env?.[name];
        if (typeof value === 'string') environment[name] = value;
    }
    return environment;
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

export async function findSessionIdFromDatabase({ projectDir, env = process.env, title }) {
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

function assertProviderRuntime(providerRuntime) {
    if (!providerRuntime || typeof providerRuntime !== 'object'
        || providerRuntime.provider !== 'opencode'
        || typeof providerRuntime.spawnWith !== 'function') {
        const error = new Error('OpenCode task requires the admitted provider runtime');
        error.code = 'PLOINKY_PROVIDER_RUNTIME_REQUIRED';
        throw error;
    }
    return providerRuntime;
}

function appendChildOutput(child, logStream, result) {
    child.stdout?.on('data', (chunk) => {
        result.stdoutTail = appendBoundedTail(result.stdoutTail, chunk);
        logStream.write(chunk);
    });
    child.stderr?.on('data', (chunk) => {
        result.stderrTail = appendBoundedTail(result.stderrTail, chunk);
        logStream.write(chunk);
    });
}

export async function runOpenCode({
    projectDir,
    model,
    variant = '',
    prompt,
    sessionId = '',
    captureSession = false,
    continuationHandle = '',
    continuationStore,
    logStream = createContainerLogStream(),
    env = process.env,
    providerRuntime,
}) {
    assertProviderRuntime(providerRuntime);
    const startedAt = Date.now();
    const args = ['run', '--auto'];
    const sessionTitle = captureSession && !sessionId
        ? `ploinky-task-${randomUUID()}`
        : '';
    if (sessionId) args.push('--session', sessionId);
    if (sessionTitle) args.push('--title', sessionTitle);
    if (model) args.push('--model', model);
    if (variant) args.push('--variant', variant);
    args.push(prompt);

    const handle = await providerRuntime.spawnWith(
        spawnTaskSandbox,
        { workdir: projectDir, args },
        {
            environment: providerEnvironment(env),
            stdio: ['ignore', 'pipe', 'pipe'],
            afterExit: async ({ launch }) => {
                if (!sessionTitle || !launch.cwd) {
                    return Object.freeze({
                        sessionId,
                        sessionLookupError: '',
                        continuationPersisted: false,
                    });
                }
                try {
                    const resolvedSessionId = await findSessionIdFromDatabase({
                        projectDir: launch.cwd,
                        env,
                        title: sessionTitle,
                    });
                    if (resolvedSessionId && continuationHandle) {
                        if (!continuationStore
                            || typeof continuationStore.writeContinuationRecord !== 'function') {
                            throw new Error('OpenCode continuation store is unavailable');
                        }
                        continuationStore.writeContinuationRecord(continuationHandle, {
                            sessionId: resolvedSessionId,
                            projectDir: launch.cwd,
                        });
                    }
                    return Object.freeze({
                        sessionId: resolvedSessionId,
                        sessionLookupError: '',
                        continuationPersisted: Boolean(resolvedSessionId && continuationHandle),
                    });
                } catch (error) {
                    return Object.freeze({
                        sessionId: '',
                        sessionLookupError: error?.message || String(error),
                        continuationPersisted: false,
                    });
                }
            },
        },
    );
    const output = { stdoutTail: '', stderrTail: '' };
    appendChildOutput(handle.child, logStream, output);
    const completion = await handle.completion;
    const effectiveProjectDir = handle.launch?.cwd || '';
    const resolvedSessionId = String(completion.afterExit?.sessionId || sessionId || '').trim();
    const sessionLookupError = String(completion.afterExit?.sessionLookupError || '').trim();
    const continuationPersisted = completion.afterExit?.continuationPersisted === true;
    return {
        code: completion.code,
        signal: completion.signal,
        durationMs: Date.now() - startedAt,
        stdoutTail: output.stdoutTail,
        stderrTail: output.stderrTail,
        sessionId: resolvedSessionId,
        sessionLookupError,
        continuationPersisted,
        outputText: output.stdoutTail.trim(),
        effectiveProjectDir,
    };
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
    continuationHandle = '',
    continuationStore,
    logStream = createContainerLogStream(),
    env = process.env,
    providerRuntime,
}) {
    const requestedProjectDir = String(projectDir || '').trim();
    const resolvedModel = typeof model === 'string' ? model.trim() : '';
    const resolvedVariant = typeof variant === 'string' ? variant.trim() : '';
    const taskPrompt = String(prompt || '').trim();
    const effectiveModel = managedOpenCodeModel(resolvedModel);
    let effectiveProjectDir = requestedProjectDir;

    try {
        const result = await runOpenCode({
            projectDir: requestedProjectDir,
            model: effectiveModel,
            variant: resolvedVariant,
            prompt: taskPrompt,
            sessionId,
            captureSession,
            continuationHandle,
            continuationStore,
            logStream,
            env,
            providerRuntime,
        });
        effectiveProjectDir = result.effectiveProjectDir || effectiveProjectDir;
        const semanticFailure = detectSemanticFailure(result);
        const outputText = result.outputText
            || summarizeOutput(result, { preferStderr: result.code !== 0 || semanticFailure });
        if (result.code !== 0 || result.signal || semanticFailure) {
            return {
                ok: false,
                error: semanticFailure
                    ? `OpenCode task failed despite exit code ${result.code ?? 'unknown'}.`
                    : summarizeFailure(result),
                outputText,
                projectDir: requestedProjectDir,
                effectiveProjectDir,
                model: effectiveModel,
                sessionId: result.sessionId || sessionId,
                continuationPersisted: result.continuationPersisted,
            };
        }
        if (captureSession && !result.sessionId) {
            return {
                ok: false,
                error: result.sessionLookupError
                    ? `OpenCode completed, but its session could not be recovered: ${result.sessionLookupError}`
                    : 'OpenCode completed, but did not persist a resumable session.',
                outputText,
                projectDir: requestedProjectDir,
                effectiveProjectDir,
                model: effectiveModel,
                sessionId: '',
            };
        }
        if (continuationHandle && !result.continuationPersisted) {
            return {
                ok: false,
                error: 'OpenCode completed, but its continuation record was not persisted.',
                outputText,
                projectDir: requestedProjectDir,
                effectiveProjectDir,
                model: effectiveModel,
                sessionId: '',
                continuationPersisted: false,
            };
        }
        return {
            ok: true,
            outputText,
            projectDir: requestedProjectDir,
            effectiveProjectDir,
            model: effectiveModel,
            sessionId: result.sessionId || sessionId,
            continuationPersisted: result.continuationPersisted,
        };
    } catch (error) {
        return {
            ok: false,
            code: error?.code,
            status: error?.status,
            cause: serializeCause(error?.cause),
            error: `OpenCode task failed: ${error.message}`,
            projectDir: requestedProjectDir,
            effectiveProjectDir,
            model: resolvedModel,
        };
    }
}

export const __testables = {
    LOG_TAIL_LIMIT,
    PROVIDER_ENV_NAMES,
    appendBoundedTail,
    managedOpenCodeModel,
    providerEnvironment,
};
