import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const DEFAULT_OPENCODE_BIN = '/root/.opencode/bin/opencode';
export const OPENCODE_TIMEOUT_MS = 300000;

const LOG_TAIL_LIMIT = 16 * 1024;
const SEMANTIC_FAILURE_PATTERNS = [
    /permission requested:\s*external_directory/i,
    /auto-rejecting/i,
    /the user rejected permission/i,
    /read \. failed/i,
];

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

export function runOpenCode({
    projectDir,
    model,
    prompt,
    sessionId = '',
    captureSession = false,
    logStream,
    env = process.env,
    opencodeBin = process.env.OPENCODE_BIN || DEFAULT_OPENCODE_BIN,
}) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const args = [
            'run',
            '--dangerously-skip-permissions',
        ];
        const jsonMode = captureSession || Boolean(sessionId);
        if (jsonMode) {
            args.push('--format', 'json');
        }
        args.push('--dir', projectDir);
        if (sessionId) {
            args.push('--session', sessionId);
        }
        if (model) {
            args.push('--model', model);
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

        let stdoutTail = '';
        let stderrTail = '';
        let stdoutBuffer = '';
        let resolvedSessionId = sessionId;
        const outputParts = [];
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
            if (!jsonMode) {
                logStream.write(chunk);
                return;
            }
            stdoutBuffer += text;
            const lines = stdoutBuffer.split(/\r?\n/);
            stdoutBuffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const event = JSON.parse(line);
                    resolvedSessionId = String(
                        event?.sessionID
                        || event?.sessionId
                        || event?.part?.sessionID
                        || event?.properties?.sessionID
                        || resolvedSessionId
                    ).trim();
                    const part = event?.part || event?.properties?.part || event?.data?.part;
                    const output = part?.type === 'text'
                        ? part.text
                        : (event?.type === 'text' ? event.text : '');
                    if (typeof output === 'string' && output) {
                        outputParts.push(output);
                        logStream.write(output);
                    }
                } catch {
                    logStream.write(`${line}\n`);
                }
            }
        });

        child.stderr.on('data', (chunk) => {
            const text = chunk.toString('utf8');
            stderrTail = appendBoundedTail(stderrTail, text);
            logStream.write(chunk);
        });

        child.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });

        child.on('close', (code, signal) => {
            clearTimeout(timeout);
            if (jsonMode && stdoutBuffer.trim()) {
                try {
                    const event = JSON.parse(stdoutBuffer);
                    resolvedSessionId = String(
                        event?.sessionID
                        || event?.sessionId
                        || event?.part?.sessionID
                        || event?.properties?.sessionID
                        || resolvedSessionId
                    ).trim();
                    const part = event?.part || event?.properties?.part || event?.data?.part;
                    const output = part?.type === 'text'
                        ? part.text
                        : (event?.type === 'text' ? event.text : '');
                    if (typeof output === 'string' && output) {
                        outputParts.push(output);
                        logStream.write(output);
                    }
                } catch {
                    logStream.write(stdoutBuffer);
                }
            }
            resolve({
                code,
                signal,
                timedOut,
                durationMs: Date.now() - startedAt,
                stdoutTail,
                stderrTail,
                sessionId: resolvedSessionId,
                outputText: outputParts.join(''),
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
    sessionId = '',
    captureSession = false,
    logStream = createContainerLogStream(),
    env = process.env,
    createProjectDir = true,
}) {
    const resolvedProjectDir = path.resolve(projectDir);
    const effectiveProjectDir = resolvedProjectDir;
    const resolvedModel = typeof model === 'string' ? model.trim() : '';
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
            prompt: taskPrompt,
            sessionId,
            captureSession,
            logStream,
            env,
            opencodeBin: env.OPENCODE_BIN || DEFAULT_OPENCODE_BIN,
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
