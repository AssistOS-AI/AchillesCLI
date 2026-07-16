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
    logStream,
    env = process.env,
    opencodeBin = process.env.OPENCODE_BIN || DEFAULT_OPENCODE_BIN,
}) {
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
            logStream,
            env,
            opencodeBin: env.OPENCODE_BIN || DEFAULT_OPENCODE_BIN,
        });

        const semanticFailure = detectSemanticFailure(result);
        const outputText = summarizeOutput(result, { preferStderr: result.code !== 0 || semanticFailure });
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
            };
        }

        return {
            ok: true,
            outputText,
            projectDir: resolvedProjectDir,
            effectiveProjectDir,
            model: resolvedModel,
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
