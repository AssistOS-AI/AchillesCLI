import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { action, HARDCODED_MODEL } from '../src/skills/launch-opencode/src/index.mjs';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TEST_DIR, '..');

test('action calls opencodeAgent execute-task with hardcoded model', async () => {
    const calls = [];
    const result = await action({
        promptText: 'build artifacts',
        mainAgent: { startDir: '/workspace/project' },
        agentClient: {
            callTool: async (toolName, payload) => {
                calls.push({ toolName, payload });
                return { ok: true, projectDir: payload.projectDir, model: payload.model };
            },
        },
    });

    assert.equal(result, 'OpenCode task completed.');
    assert.deepEqual(calls, [{
        toolName: 'execute-task',
        payload: {
            prompt: 'build artifacts',
            projectDir: '/workspace/project',
            model: HARDCODED_MODEL,
        },
    }]);
});

test('action does not use legacy callAgentTool fallback', async () => {
    const result = await action({
        promptText: 'build artifacts',
        mainAgent: { startDir: '/workspace/project' },
        agentClient: {
            callTool: async (toolName, payload) => {
                assert.equal(toolName, 'execute-task');
                return { ok: true, projectDir: payload.projectDir, model: payload.model };
            },
        },
        callAgentTool: async () => {
            throw new Error('legacy helper must not be used');
        },
    });

    assert.equal(result, 'OpenCode task completed.');
});

test('action fails clearly when Ploinky AgentMcpClient credentials are unavailable', async () => {
    const oldId = process.env.PLOINKY_AGENT_ID;
    const oldSecret = process.env.PLOINKY_AGENT_SECRET;
    delete process.env.PLOINKY_AGENT_ID;
    delete process.env.PLOINKY_AGENT_SECRET;
    try {
        const result = await action({
            promptText: 'build artifacts',
            mainAgent: { startDir: '/workspace/project' },
        });

        assert.match(result, /Ploinky agent credentials are required/);
    } finally {
        if (oldId === undefined) delete process.env.PLOINKY_AGENT_ID;
        else process.env.PLOINKY_AGENT_ID = oldId;
        if (oldSecret === undefined) delete process.env.PLOINKY_AGENT_SECRET;
        else process.env.PLOINKY_AGENT_SECRET = oldSecret;
    }
});

test('action uses mainAgent.startDir as the current AchillesCLI working directory', async () => {
    const calls = [];
    await action({
        promptText: JSON.stringify({ prompt: 'run checks' }),
        mainAgent: { startDir: '/workspace/copilot' },
        agentClient: {
            callTool: async (toolName, payload) => {
                calls.push({ toolName, payload });
                return { ok: true };
            },
        },
    });

    assert.equal(calls[0].payload.prompt, 'run checks');
    assert.equal(calls[0].payload.projectDir, '/workspace/copilot');
    assert.equal(calls[0].payload.model, HARDCODED_MODEL);
});

test('action returns successful opencode output as plain text', async () => {
    const result = await action({
        promptText: 'build artifacts',
        mainAgent: { startDir: '/workspace/project' },
        agentClient: {
            callTool: async () => ({
                ok: true,
                outputText: 'created files\nran tests',
            }),
        },
    });

    assert.equal(result, 'OpenCode task completed.\n\ncreated files\nran tests');
});

test('action polls async opencode task and emits progress', async () => {
    const progress = [];
    const statuses = [
        {
            id: 'task-1',
            status: 'running',
            logTail: '[opencode stdout] first\n',
            logSeq: 1,
        },
        {
            id: 'task-1',
            status: 'completed',
            logTail: '[opencode stdout] first\n[opencode stdout] done\n',
            logSeq: 2,
            result: {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ ok: true, outputText: 'final output' }),
                }],
            },
        },
    ];

    const result = await action({
        promptText: 'build artifacts',
        mainAgent: { startDir: '/workspace/project' },
        pollIntervalMs: 0,
        progressWriter: { write: (entry) => progress.push(entry) },
        agentClient: {
            callTool: async () => ({
                content: [{ type: 'text', text: "Task 'execute-task' queued with id task-1" }],
                metadata: { taskId: 'task-1', status: 'running' },
            }),
            getTaskStatus: async (taskId) => {
                assert.equal(taskId, 'task-1');
                return statuses.shift();
            },
        },
    });

    assert.equal(result, 'OpenCode task completed.\n\nfinal output');
    assert.equal(progress.length, 2);
    assert.deepEqual(progress.map((entry) => entry.type), ['tool_reason', 'tool_reason']);
    assert.match(progress[0].reason, /first/);
    assert.match(progress[1].reason, /done/);
});

test('action reports failed async opencode task as plain text', async () => {
    const result = await action({
        promptText: 'build artifacts',
        pollIntervalMs: 0,
        agentClient: {
            callTool: async () => ({
                metadata: { taskId: 'task-fail', status: 'running' },
            }),
            getTaskStatus: async () => ({
                id: 'task-fail',
                status: 'failed',
                error: 'opencode failed in queue',
                logTail: '[opencode stderr] details\n',
                logSeq: 1,
            }),
        },
    });

    assert.equal(result, 'opencode failed in queue\n\n[opencode stderr] details');
});

test('action uses process cwd only without mainAgent.startDir', async () => {
    const calls = [];
    await action({
        promptText: 'run checks',
        agentClient: {
            callTool: async (toolName, payload) => {
                calls.push({ toolName, payload });
                return { ok: true };
            },
        },
    });

    assert.equal(calls[0].payload.projectDir, process.cwd());
});

test('action returns plain text for missing prompt', async () => {
    const result = await action({ promptText: '   ' });

    assert.match(result, /needs a natural-language task/);
});

test('action returns plain agent error text', async () => {
    const result = await action({
        promptText: 'build artifacts',
        agentClient: {
            callTool: async () => ({ ok: false, error: 'opencode failed' }),
        },
    });

    assert.equal(result, 'opencode failed');
});

test('action returns plain MCP exception text', async () => {
    const result = await action({
        promptText: 'build artifacts',
        agentClient: {
            callTool: async () => {
                throw new Error('router unavailable');
            },
        },
    });

    assert.equal(result, 'OpenCode task failed: router unavailable');
});

test('AchillesCLI manifest enables opencodeAgent globally', async () => {
    const manifest = JSON.parse(await readFile(join(REPO_ROOT, 'manifest.json'), 'utf8'));

    assert.ok(Array.isArray(manifest.enable));
    assert.ok(manifest.enable.includes('copilot-agents/opencodeAgent global'));
});
