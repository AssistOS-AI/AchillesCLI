import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const DEFAULT_CODEX_HOME = '/root';
export const DEFAULT_CODEX_BIN = '/root/.local/bin/codex';
export const MANAGED_SOUL_MODEL = 'fast';
export const MANAGED_SOUL_PROVIDER = 'ploinky_soul';

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
    const home = String(env.HOME || DEFAULT_CODEX_HOME);
    const homeBinary = path.join(home, '.local', 'bin', 'codex');
    return fs.existsSync(homeBinary) ? homeBinary : 'codex';
}

function textValue(value) {
    return typeof value === 'string' ? value : '';
}

function tomlString(value) {
    return JSON.stringify(String(value));
}

export function resolveManagedSoulProvider(env = process.env) {
    const keySource = String(env.PLOINKY_ENV_SOURCE_PLOINKY_AGENT_API_KEY || '').trim();
    const routerSource = String(env.PLOINKY_ENV_SOURCE_PLOINKY_ROUTER_URL || '').trim();
    const authoritySource = String(
        env.PLOINKY_ENV_SOURCE_PLOINKY_ROUTER_REQUEST_AUTHORITY || '',
    ).trim();
    const generatedMode = keySource === 'generated'
        || routerSource === 'generated'
        || authoritySource === 'generated';
    if (!generatedMode) return null;
    if (keySource !== 'generated'
        || routerSource !== 'generated'
        || authoritySource !== 'generated') {
        throw new Error(
            'Managed Codex routing requires generated provenance for Router URL, request authority, and agent API key',
        );
    }
    const routerUrl = String(env.PLOINKY_ROUTER_URL || '').trim();
    const requestAuthority = String(env.PLOINKY_ROUTER_REQUEST_AUTHORITY || '').trim();
    const apiKey = String(env.PLOINKY_AGENT_API_KEY || '').trim();
    if (!routerUrl || !requestAuthority || !apiKey) {
        throw new Error(
            'Managed Codex routing requires PLOINKY_ROUTER_URL, PLOINKY_ROUTER_REQUEST_AUTHORITY, and PLOINKY_AGENT_API_KEY',
        );
    }
    let baseUrl;
    try {
        const parsed = new URL(routerUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)
            || parsed.username || parsed.password || parsed.search || parsed.hash) {
            throw new Error('unsupported Router URL');
        }
        parsed.pathname = '/base-agent-additional-server/soul-gateway/7000/v1';
        baseUrl = parsed.toString().replace(/\/$/, '');
    } catch (cause) {
        throw new Error('PLOINKY_ROUTER_URL is not a valid managed Router URL', { cause });
    }
    try {
        if (/[\u0000-\u0020\u007f/?#@]/u.test(requestAuthority)) {
            throw new Error('unsupported Router request authority');
        }
        const parsed = new URL(`http://${requestAuthority}`);
        if (!parsed.hostname || parsed.host !== requestAuthority
            || parsed.username || parsed.password || parsed.pathname !== '/'
            || parsed.search || parsed.hash) {
            throw new Error('unsupported Router request authority');
        }
    } catch (cause) {
        throw new Error('PLOINKY_ROUTER_REQUEST_AUTHORITY is not a valid managed Router authority', { cause });
    }
    return Object.freeze({
        provider: MANAGED_SOUL_PROVIDER,
        baseUrl,
        requestAuthority,
        model: MANAGED_SOUL_MODEL,
    });
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

export function buildCodexArgs({ prompt, model = '', threadId = '' }, env = process.env) {
    const managed = resolveManagedSoulProvider(env);
    const globalArgs = [
        '--sandbox',
        'workspace-write',
        '--ask-for-approval',
        'never',
        ...(managed ? [
            '--config', `model_provider=${tomlString(managed.provider)}`,
            '--config', `model_providers.${managed.provider}.name=${tomlString('Ploinky Soul Gateway')}`,
            '--config', `model_providers.${managed.provider}.base_url=${tomlString(managed.baseUrl)}`,
            '--config', `model_providers.${managed.provider}.http_headers={Host=${tomlString(managed.requestAuthority)}}`,
            '--config', `model_providers.${managed.provider}.env_key=${tomlString('PLOINKY_AGENT_API_KEY')}`,
            '--config', `model_providers.${managed.provider}.wire_api=${tomlString('responses')}`,
            '--config', `model_providers.${managed.provider}.requires_openai_auth=false`,
            '--config', 'shell_environment_policy.ignore_default_excludes=false',
            ...(!String(model || '').trim()
                ? ['--config', `model=${tomlString(managed.model)}`]
                : []),
        ] : []),
    ];
    const effectiveModel = String(model || '').trim();
    if (threadId) {
        return [
            ...globalArgs,
            'exec',
            'resume',
            '--json',
            '--skip-git-repo-check',
            ...(effectiveModel ? ['--model', effectiveModel] : []),
            threadId,
            prompt,
        ];
    }
    return [
        ...globalArgs,
        'exec',
        '--json',
        '--skip-git-repo-check',
        ...(effectiveModel ? ['--model', effectiveModel] : []),
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
    signal,
}) {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const args = buildCodexArgs({ prompt, model, threadId }, env);
        const child = spawn(resolveCodexBinary(env), args, {
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
        let jsonBuffer = '';
        let resolvedThreadId = threadId;
        let outputText = '';
        let visibleTextTail = '';

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
            signal?.removeEventListener?.('abort', abort);
            reject(error);
        });
        child.on('close', (code, closeSignal) => {
            signal?.removeEventListener?.('abort', abort);
            if (jsonBuffer) consumeLine(jsonBuffer, false);
            resolve({
                code,
                signal: closeSignal,
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
    return `Codex task failed with exit code ${result.code ?? 'unknown'}${result.signal ? ` signal ${result.signal}` : ''}`;
}

export async function executeCodexTask({
    prompt,
    projectDir,
    model = '',
    threadId = '',
    logStream = createContainerLogStream(),
    env = process.env,
    signal,
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
            signal,
        });
        const outputText = result.outputText
            || (result.stderrTail || '').trim()
            || (result.visibleTextTail || '').trim();
        if (result.code !== 0) {
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
