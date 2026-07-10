#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

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

function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function unwrapToolPayload(value) {
    const direct = normalizePayload(value);
    if (isSearchPayload(direct)) return direct;

    const candidates = [
        ...(Array.isArray(direct.content) ? direct.content : []),
        ...(Array.isArray(direct.result?.content) ? direct.result.content : []),
    ];
    for (const entry of candidates) {
        if (entry?.type !== 'text' || typeof entry.text !== 'string') continue;
        const parsed = parseJsonObject(entry.text);
        if (isSearchPayload(parsed)) return parsed;
    }

    return {
        ok: false,
        error: 'SearchAgent MCP returned an invalid search payload.',
    };
}

function isSearchPayload(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        && (
            Array.isArray(value.results)
            || value.ok === true
            || value.ok === false
            || value.error !== undefined
        );
}

function parseJsonObject(value) {
    try {
        const parsed = JSON.parse(value);
        return normalizePayload(parsed);
    } catch {
        return {};
    }
}

async function main() {
    const input = normalizePayload(await readStdinJson());
    const module = await import('/Agent/client/AgentMcpClient.mjs');
    if (!module || typeof module.createAgentClient !== 'function') {
        throw new Error('AgentMcpClient module does not expose createAgentClient.');
    }
    const client = await module.createAgentClient('searchAgent');
    const provider = trim(input.provider) || trim(process.env.SEARCH_AGENT_PROVIDER);
    const result = await client.callTool('search_agent_search', {
        provider,
        query: input.query,
        maxResults: input.maxResults,
    });
    process.stdout.write(JSON.stringify(unwrapToolPayload(result)));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    try {
        await main();
    } catch (error) {
        process.stdout.write(JSON.stringify({
            ok: false,
            error: error?.message || 'SearchAgent MCP call failed.',
        }));
        process.exitCode = 1;
    }
}
