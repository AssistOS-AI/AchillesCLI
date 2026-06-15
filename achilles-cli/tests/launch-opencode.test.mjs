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
        callAgentTool: async (agentName, toolName, payload) => {
            calls.push({ agentName, toolName, payload });
            return { ok: true, projectDir: payload.projectDir, model: payload.model };
        },
    });

    assert.equal(result, 'OpenCode task completed.');
    assert.deepEqual(calls, [{
        agentName: 'opencodeAgent',
        toolName: 'execute-task',
        payload: {
            prompt: 'build artifacts',
            projectDir: '/workspace/project',
            model: HARDCODED_MODEL,
        },
    }]);
});

test('action uses mainAgent.startDir as the current AchillesCLI working directory', async () => {
    const calls = [];
    await action({
        promptText: JSON.stringify({ prompt: 'run checks' }),
        mainAgent: { startDir: '/workspace/copilot' },
        callAgentTool: async (agentName, toolName, payload) => {
            calls.push({ agentName, toolName, payload });
            return { ok: true };
        },
    });

    assert.equal(calls[0].payload.prompt, 'run checks');
    assert.equal(calls[0].payload.projectDir, '/workspace/copilot');
    assert.equal(calls[0].payload.model, HARDCODED_MODEL);
});

test('action falls back to process cwd only without mainAgent.startDir', async () => {
    const calls = [];
    await action({
        promptText: 'run checks',
        callAgentTool: async (agentName, toolName, payload) => {
            calls.push({ agentName, toolName, payload });
            return { ok: true };
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
        callAgentTool: async () => ({ ok: false, error: 'opencode failed' }),
    });

    assert.equal(result, 'opencode failed');
});

test('action returns plain MCP exception text', async () => {
    const result = await action({
        promptText: 'build artifacts',
        callAgentTool: async () => {
            throw new Error('router unavailable');
        },
    });

    assert.equal(result, 'OpenCode task failed: router unavailable');
});

test('AchillesCLI manifest enables opencodeAgent globally', async () => {
    const manifest = JSON.parse(await readFile(join(REPO_ROOT, 'manifest.json'), 'utf8'));

    assert.ok(Array.isArray(manifest.enable));
    assert.ok(manifest.enable.includes('copilot-agents/opencodeAgent global'));
});
