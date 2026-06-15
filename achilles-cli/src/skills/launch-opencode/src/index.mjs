import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import { callAgentTool, extractToolJson } from '../../../lib/agentMcpClient.mjs';

export const TARGET_AGENT = 'opencodeAgent';
export const TOOL_NAME = 'execute-task';
export const HARDCODED_MODEL = 'xai/grok-4.20-0309-non-reasoning';

const DEFAULT_TIMEOUT_MS = 450000;

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
    const agentClientPath = '/Agent/client/AgentMcpClient.mjs';
    if (!process.env.PLOINKY_AGENT_ID || !process.env.PLOINKY_AGENT_SECRET) {
        return null;
    }
    if (!fs.existsSync(agentClientPath)) {
        return null;
    }
    const module = await import(pathToFileURL(agentClientPath).href);
    if (typeof module.createAgentClient !== 'function') {
        return null;
    }
    return module.createAgentClient(agentName);
}

async function callExecuteTask(payload, invocation = {}) {
    if (typeof invocation.callAgentTool === 'function') {
        return invocation.callAgentTool(TARGET_AGENT, TOOL_NAME, payload, invocation);
    }

    const nativeClient = await createPloinkyAgentClient(TARGET_AGENT);
    if (nativeClient) {
        return nativeClient.callTool(TOOL_NAME, payload, {
            userDelegationToken: trim(invocation.userDelegationToken || invocation.context?.userDelegationToken),
        });
    }

    const response = await callAgentTool(TARGET_AGENT, TOOL_NAME, payload, {
        invocationToken: trim(invocation.invocationToken || invocation.context?.invocationToken),
        timeoutMs: Number(invocation.timeoutMs) || DEFAULT_TIMEOUT_MS,
        signal: invocation.signal || invocation.context?.signal,
        env: invocation.env || process.env,
    });
    return extractToolJson(response);
}

function normalizeAnswer(payload) {
    if (!payload || typeof payload !== 'object') {
        return 'OpenCode completed without a response.';
    }
    if (payload.ok === false && payload.error) {
        return String(payload.error).trim();
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
        const result = await callExecuteTask(payload, invocation);
        return normalizeAnswer(result);
    } catch (error) {
        return `OpenCode task failed: ${error?.message || 'delegated task failed'}`;
    }
}

export default action;
