import { createAgentClient } from '/Agent/client/AgentMcpClient.mjs';

export const TARGET_AGENT = 'opencodeAgent';
export const TOOL_NAME = 'execute-task';
export const HARDCODED_MODEL = 'xai/grok-4.20-0309-non-reasoning';

const DEFAULT_TIMEOUT_MS = 450000;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const PROGRESS_CHUNK_LIMIT = 3000;

function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizePrompt(invocation = {}) {
    if (typeof invocation.prompt === 'string') {
        return trim(invocation.prompt);
    }
    if (typeof invocation.promptText === 'string') {
        const text = trim(invocation.promptText);
        if (!text) return '';
        try {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return trim(parsed.prompt || parsed.task || parsed.taskDescription);
            }
        } catch {
        }
        return text;
    }
    return '';
}

function resolveProjectDir(invocation = {}) {
    return trim(invocation.mainAgent?.startDir) || process.cwd();
}

async function createPloinkyAgentClient(agentName) {
    if (!process.env.PLOINKY_AGENT_ID || !process.env.PLOINKY_AGENT_SECRET) {
        throw new Error('Ploinky agent credentials are required for OpenCode delegation.');
    }
    return createAgentClient(agentName);
}

async function resolveAgentClient(invocation = {}) {
    if (invocation.agentClient && typeof invocation.agentClient.callTool === 'function') {
        return invocation.agentClient;
    }
    if (!process.env.PLOINKY_AGENT_ID || !process.env.PLOINKY_AGENT_SECRET) {
        throw new Error('Ploinky agent credentials are required for OpenCode delegation.');
    }
    return createPloinkyAgentClient(TARGET_AGENT);
}

async function callExecuteTask(payload, invocation = {}) {
    const client = await resolveAgentClient(invocation);
    return client.callTool(TOOL_NAME, payload, {
        userDelegationToken: trim(invocation.userDelegationToken || invocation.context?.userDelegationToken),
    });
}

function extractTaskId(payload) {
    return trim(payload?.metadata?.taskId || payload?.result?.metadata?.taskId || payload?.taskId);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function limitProgressText(text) {
    const trimmed = trim(text);
    if (!trimmed) {
        return '';
    }
    if (trimmed.length <= PROGRESS_CHUNK_LIMIT) {
        return trimmed;
    }
    return trimmed.slice(trimmed.length - PROGRESS_CHUNK_LIMIT);
}

function formatFailurePayload(payload) {
    const errorText = trim(payload.error);
    const outputText = trim(payload.outputText);
    if (!errorText) {
        return outputText || 'OpenCode task failed.';
    }
    if (!outputText || outputText === errorText) {
        return errorText;
    }
    return `${errorText}\n\n${outputText}`;
}

function getProgressWriter(invocation = {}) {
    if (invocation.progressWriter?.write) {
        return invocation.progressWriter;
    }
    if (invocation.context?.progressWriter?.write) {
        return invocation.context.progressWriter;
    }
    const supervisorWriter = invocation.mainAgent?.supervisor?.getOutputWriter?.();
    if (supervisorWriter?.write) {
        return supervisorWriter;
    }
    return null;
}

function emitProgress(invocation, text) {
    const reason = limitProgressText(text);
    if (!reason) {
        return;
    }
    const writer = getProgressWriter(invocation);
    if (!writer) {
        return;
    }
    try {
        writer.write({
            type: 'tool_reason',
            tool: 'launch-opencode',
            reason,
        });
    } catch {
    }
}

async function getTaskStatus(invocation, taskId) {
    const client = await resolveAgentClient(invocation);
    if (typeof client.getTaskStatus !== 'function') {
        throw new Error('Ploinky AgentMcpClient does not provide getTaskStatus.');
    }
    return client.getTaskStatus(taskId);
}

function parseTaskResult(task) {
    const content = Array.isArray(task?.result?.content) ? task.result.content : [];
    const text = trim(content.find((entry) => entry?.type === 'text' && typeof entry.text === 'string')?.text);
    if (!text) {
        return { ok: true };
    }
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : { ok: true, outputText: text };
    } catch {
        return { ok: true, outputText: text };
    }
}

async function pollTask(taskId, invocation = {}) {
    const timeoutMs = Number(invocation.timeoutMs) || DEFAULT_TIMEOUT_MS;
    const pollIntervalMs = Number.isFinite(Number(invocation.pollIntervalMs))
        ? Math.max(0, Number(invocation.pollIntervalMs))
        : DEFAULT_POLL_INTERVAL_MS;
    const signal = invocation.signal || invocation.context?.signal;
    const startedAt = Date.now();
    let lastLogSeq = -1;
    let lastLogTail = '';

    while (Date.now() - startedAt <= timeoutMs) {
        if (signal?.aborted) {
            throw new Error('OpenCode task polling aborted.');
        }

        const task = await getTaskStatus(invocation, taskId);
        const logTail = typeof task?.logTail === 'string' ? task.logTail : '';
        const logSeq = Number.isFinite(Number(task?.logSeq)) ? Number(task.logSeq) : lastLogSeq;
        if (logTail && (logSeq !== lastLogSeq || logTail !== lastLogTail)) {
            const delta = logTail.startsWith(lastLogTail) ? logTail.slice(lastLogTail.length) : logTail;
            emitProgress(invocation, delta);
            lastLogTail = logTail;
            lastLogSeq = logSeq;
        }

        if (task?.status === 'completed') {
            return parseTaskResult(task);
        }
        if (task?.status === 'failed' || task?.status === 'cancelled') {
            return {
                ok: false,
                error: trim(task.error) || `OpenCode task ${task.status}.`,
                outputText: logTail,
            };
        }

        await sleep(pollIntervalMs);
    }

    throw new Error(`OpenCode task ${taskId} did not finish within ${timeoutMs}ms.`);
}

function normalizeAnswer(payload) {
    if (!payload || typeof payload !== 'object') {
        return 'OpenCode completed without a response.';
    }
    if (payload.ok === false && payload.error) {
        return formatFailurePayload(payload);
    }
    const outputText = trim(payload.outputText);
    if (outputText) {
        return `OpenCode task completed.\n\n${outputText}`;
    }
    return 'OpenCode task completed.';
}

export async function action(invocation = {}) {
    const prompt = normalizePrompt(invocation);
    if (!prompt) {
        return 'OpenCode needs a natural-language task to run.';
    }

    const payload = {
        prompt,
        projectDir: resolveProjectDir(invocation),
        model: HARDCODED_MODEL,
    };

    try {
        let result = await callExecuteTask(payload, invocation);
        const taskId = extractTaskId(result);
        if (taskId) {
            result = await pollTask(taskId, invocation);
        }
        return normalizeAnswer(result);
    } catch (error) {
        return `OpenCode task failed: ${error?.message || 'delegated task failed'}`;
    }
}

export default action;
