function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
}

async function resolveAgentClient(agentName, invocation = {}) {
    if (invocation.agentClient && typeof invocation.agentClient.callToolWithoutWait === 'function') {
        return invocation.agentClient;
    }

    if (!process.env.PLOINKY_AGENT_ID || !process.env.PLOINKY_AGENT_SECRET) {
        throw new Error('Ploinky agent credentials are required for task delegation.');
    }

    const module = await import('/Agent/client/AgentMcpClient.mjs');
    if (!module?.createAgentClient || typeof module.createAgentClient !== 'function') {
        throw new Error('Ploinky AgentMcpClient is unavailable in this runtime.');
    }

    return module.createAgentClient(agentName, {
        userDelegationToken: trim(invocation.userDelegationToken || invocation.context?.userDelegationToken),
    });
}

function parseTaskResult(payload) {
    if (!payload || typeof payload !== 'object') {
        return { ok: true };
    }

    const content = Array.isArray(payload.result?.content)
        ? payload.result.content
        : Array.isArray(payload.content)
            ? payload.content
            : [];
    const text = trim(content.find((entry) => entry?.type === 'text' && typeof entry.text === 'string')?.text);

    try {
        if (!text) {
            throw new Error('no mcp text');
        }
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
            return {
                ...payload,
                ...parsed,
            };
        }
        return {
            ...payload,
            ok: true,
            outputText: text,
        };
    } catch {
        if (text) {
            return {
                ...payload,
                ok: true,
                outputText: text,
            };
        }
    }

    const hasStatus = typeof payload.status === 'string' || typeof payload.logTail === 'string' || typeof payload.logSeq !== 'undefined' || payload?.result;
    const hasMetadata = payload?.metadata || payload?.result?.metadata;
    if (payload.outputText !== undefined || payload.ok !== undefined || typeof payload.error === 'string' || hasStatus || hasMetadata) {
        return payload;
    }

    return { ok: true };
}

async function callAgentTool(agentName, toolName, payload, invocation = {}) {
    const client = await resolveAgentClient(agentName, invocation);
    return client.callToolWithoutWait(toolName, payload, {
        userDelegationToken: trim(invocation.userDelegationToken || invocation.context?.userDelegationToken),
    });
}

export const TARGET_AGENT = 'piAgent';
export const TOOL_NAME = 'execute-task';

function parseModelTaskText(text) {
    const match = trim(text).match(/^model\s*:\s*(\S+)\s+task\s*:\s*([\s\S]+)$/i);
    if (!match) {
        return { prompt: trim(text), model: '' };
    }
    return {
        model: trim(match[1]),
        prompt: trim(match[2]),
    };
}

function normalizePrompt(invocation = {}) {
    const candidate = typeof invocation.promptText === 'string'
        ? invocation.promptText
        : typeof invocation.prompt === 'string'
        ? invocation.prompt
        : '';
    const text = trim(candidate);
    if (!text) {
        return { prompt: '', model: '' };
    }
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return {
                prompt: trim(parsed.prompt || parsed.task || parsed.taskDescription),
                model: trim(parsed.model || parsed.agentModel || parsed.llm),
            };
        }
    } catch {
    }
    return parseModelTaskText(text);
}

function resolvePromptModel(invocation = {}) {
    const parsed = normalizePrompt(invocation);
    return {
        prompt: trim(parsed.prompt),
        model: trim(parsed.model || invocation.model),
    };
}

function resolveProjectDir(invocation = {}) {
    return trim(invocation.mainAgent?.startDir) || process.cwd();
}

function formatFailurePayload(payload) {
    const errorText = trim(payload.error);
    const outputText = trim(payload.outputText || payload.logTail);
    if (!errorText) {
        return outputText || 'PI task failed.';
    }
    if (!outputText || outputText === errorText) {
        return errorText;
    }
    return `${errorText}\n\n${outputText}`;
}

function normalizeAnswer(payload) {
    if (!payload || typeof payload !== 'object') {
        return 'PI task completed without a response.';
    }
    const backgroundTask = payload?.metadata?.backgroundTask;
    if (backgroundTask?.detached) {
        return 'Task started.';
    }
    if (trim(payload?.metadata?.taskId || payload?.result?.metadata?.taskId)) {
        return 'Task started.';
    }
    if (payload.ok === false && payload.error) {
        return formatFailurePayload(payload);
    }
    const outputText = trim(payload.outputText);
    if (outputText) {
        return `PI task completed.\n\n${outputText}`;
    }
    return 'PI task completed.';
}

export async function action(invocation = {}) {
    const { prompt, model } = resolvePromptModel(invocation);
    if (!prompt) {
        return 'PI needs a natural-language task to run.';
    }

    const payload = {
        prompt,
        projectDir: resolveProjectDir(invocation),
    };
    if (model) {
        payload.model = model;
    }

    try {
        const result = parseTaskResult(await callAgentTool(TARGET_AGENT, TOOL_NAME, payload, {
            agentClient: invocation.agentClient,
            userDelegationToken: invocation.userDelegationToken,
            context: invocation.context,
        }));
        return normalizeAnswer(result);
    } catch (error) {
        if (error?.task) {
            const failed = parseTaskResult(error.task);
            return `PI task failed: ${formatFailurePayload(failed)}`;
        }
        return `PI task failed: ${error?.message || 'delegated task failed'}`;
    }
}

export default action;
