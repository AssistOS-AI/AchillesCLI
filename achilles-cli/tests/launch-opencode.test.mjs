import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { action, TARGET_AGENT_REF } from '../src/skills/launch-opencode/src/index.mjs';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TEST_DIR, '..');

test('action lets opencodeAgent select its model when no override is provided', async () => {
    const calls = [];
    const starts = [];
    const result = await action({
        promptText: 'build artifacts',
        mainAgent: { startDir: '/workspace/project' },
        agentClient: {
            ensureAgentRunning: async (agentRef, options) => starts.push({ agentRef, options }),
            callToolWithoutWait: async (toolName, payload) => {
                calls.push({ toolName, payload });
                return { ok: true, projectDir: payload.projectDir, model: payload.model };
            },
        },
    });

    assert.equal(result, 'OpenCode task completed.');
    assert.deepEqual(starts, [{
        agentRef: TARGET_AGENT_REF,
        options: { mode: 'global', timeoutMs: 180000 },
    }]);
    assert.deepEqual(calls, [{
        toolName: 'execute-task',
        payload: {
            prompt: 'build artifacts',
            projectDir: '/workspace/project',
        },
    }]);
});

test('action treats model-shaped text as the literal task and ignores invocation.model', async () => {
    const calls = [];
    const result = await action({
        promptText: 'model: anthropic/claude-test task: build artifacts: include tests',
        model: 'fast',
        mainAgent: { startDir: '/workspace/project' },
        agentClient: {
            callToolWithoutWait: async (toolName, payload) => {
                calls.push({ toolName, payload });
                return { ok: true };
            },
        },
    });

    assert.equal(result, 'OpenCode task completed.');
    assert.equal(calls[0].payload.model, undefined);
    assert.equal(calls[0].payload.prompt, 'model: anthropic/claude-test task: build artifacts: include tests');
});

test('action treats JSON-shaped text as the literal task', async () => {
    const calls = [];
    const task = JSON.stringify({
        task: 'run checks',
        model: 'openrouter/model',
    });
    await action({
        promptText: task,
        agentClient: {
            callToolWithoutWait: async (toolName, payload) => {
                calls.push({ toolName, payload });
                return { ok: true };
            },
        },
    });

    assert.equal(calls[0].payload.model, undefined);
    assert.equal(calls[0].payload.prompt, task);
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
        promptText: 'run checks',
        mainAgent: { startDir: '/workspace/copilot' },
        agentClient: {
            callToolWithoutWait: async (toolName, payload) => {
                calls.push({ toolName, payload });
                return { ok: true };
            },
        },
    });

    assert.equal(calls[0].payload.prompt, 'run checks');
    assert.equal(calls[0].payload.projectDir, '/workspace/copilot');
    assert.equal(calls[0].payload.model, undefined);
});

test('action returns successful opencode output as plain text', async () => {
    const result = await action({
        promptText: 'build artifacts',
        mainAgent: { startDir: '/workspace/project' },
        agentClient: {
            callToolWithoutWait: async () => ({
                ok: true,
                outputText: 'created files\nran tests',
            }),
        },
    });

    assert.equal(result, 'OpenCode task completed.\n\ncreated files\nran tests');
});

test('action uses the non-blocking client path without callback polling', async () => {
    let capturedOptions = null;
    const result = await action({
        promptText: 'build artifacts',
        mainAgent: { startDir: '/workspace/project' },
        agentClient: {
            callToolWithoutWait: async (_toolName, _payload, options) => {
                capturedOptions = options;
                return {
                    ok: true,
                    outputText: 'final output',
                };
            },
        },
    });

    assert.equal(result, 'OpenCode task completed.\n\nfinal output');
    assert.equal(capturedOptions.onTaskUpdate, undefined);
});

test('action reports failed async opencode task errors', async () => {
    const error = new Error('opencode failed in queue');
    error.task = {
        error: 'opencode failed in queue',
        logTail: '[opencode stderr] details\n',
        status: 'failed',
    };

    const result = await action({
        promptText: 'build artifacts',
        agentClient: {
            callToolWithoutWait: async () => {
                throw error;
            },
        },
    });

    assert.equal(result, 'OpenCode task failed: opencode failed in queue\n\n[opencode stderr] details');
});

test('action uses process cwd only without mainAgent.startDir', async () => {
    const calls = [];
    await action({
        promptText: 'run checks',
        agentClient: {
            callToolWithoutWait: async (toolName, payload) => {
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
            callToolWithoutWait: async () => ({ ok: false, error: 'opencode failed' }),
        },
    });

    assert.equal(result, 'opencode failed');
});

test('action returns plain MCP exception text', async () => {
    const result = await action({
        promptText: 'build artifacts',
        agentClient: {
            callToolWithoutWait: async () => {
                throw new Error('router unavailable');
            },
        },
    });

    assert.equal(result, 'OpenCode task failed: router unavailable');
});

test('AchillesCLI manifest leaves delegated coding agents out of eager dependencies', async () => {
    const manifest = JSON.parse(await readFile(join(REPO_ROOT, 'manifest.json'), 'utf8'));

    assert.ok(Array.isArray(manifest.enable));
    assert.ok(!manifest.enable.some((entry) => String(entry).includes('opencodeAgent')));
    assert.ok(!manifest.enable.some((entry) => String(entry).includes('piAgent')));
});
