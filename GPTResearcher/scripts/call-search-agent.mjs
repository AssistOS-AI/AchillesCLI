#!/usr/bin/env node

async function readStdinJson() {
    if (process.stdin.isTTY) return {};
    process.stdin.setEncoding('utf8');
    let data = '';
    for await (const chunk of process.stdin) {
        data += chunk;
    }
    const text = data.trim();
    return text ? JSON.parse(text) : {};
}

function normalizePayload(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

try {
    const input = normalizePayload(await readStdinJson());
    const module = await import('/Agent/client/AgentMcpClient.mjs');
    if (!module || typeof module.createAgentClient !== 'function') {
        throw new Error('AgentMcpClient module does not expose createAgentClient.');
    }
    const client = await module.createAgentClient('searchAgent');
    const result = await client.callTool('search_agent_search', input);
    process.stdout.write(JSON.stringify(result));
} catch (error) {
    process.stdout.write(JSON.stringify({
        ok: false,
        error: error?.message || 'SearchAgent MCP call failed.',
    }));
    process.exitCode = 1;
}
