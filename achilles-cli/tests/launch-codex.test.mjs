import test from 'node:test';
import assert from 'node:assert/strict';

import { action, TARGET_AGENT_REF } from '../src/skills/launch-codex/src/index.mjs';

test('action starts codexAgent globally and omits model from the payload', async () => {
    const calls = [];
    const starts = [];
    const result = await action({
        promptText: 'create a report',
        model: 'must-not-be-forwarded',
        mainAgent: { startDir: '/workspace/project' },
        agentClient: {
            ensureAgentRunning: async (agentRef, options) => starts.push({ agentRef, options }),
            callToolWithoutWait: async (toolName, payload) => {
                calls.push({ toolName, payload });
                return { ok: true };
            },
        },
    });

    assert.equal(result, 'Codex task completed.');
    assert.deepEqual(starts, [{
        agentRef: TARGET_AGENT_REF,
        options: { mode: 'global', timeoutMs: 180000 },
    }]);
    assert.deepEqual(calls, [{
        toolName: 'execute-task',
        payload: {
            prompt: 'create a report',
            projectDir: '/workspace/project',
        },
    }]);
});

test('action treats JSON-shaped text as a literal Codex task', async () => {
    const task = JSON.stringify({ prompt: 'build', model: 'override/model' });
    const result = await action({
        promptText: task,
        agentClient: {
            callToolWithoutWait: async (toolName, payload) => {
                assert.equal(toolName, 'execute-task');
                assert.equal(payload.prompt, task);
                assert.equal(payload.model, undefined);
                return { ok: true, outputText: 'done' };
            },
        },
    });
    assert.equal(result, 'Codex task completed.\n\ndone');
});

test('action reports async and failed Codex work as plain text', async () => {
    const started = await action({
        promptText: 'build',
        agentClient: {
            callToolWithoutWait: async () => ({
                metadata: { taskId: 'remote-1', status: 'queued' },
            }),
        },
    });
    assert.equal(started, 'Task started.');

    const failure = new Error('failed');
    failure.task = {
        error: 'codex failed in queue',
        logTail: 'provider details\n',
        status: 'failed',
    };
    const failed = await action({
        promptText: 'build',
        agentClient: {
            callToolWithoutWait: async () => { throw failure; },
        },
    });
    assert.equal(failed, 'Codex task failed: codex failed in queue\n\nprovider details');
});

test('action requires a natural-language task', async () => {
    assert.match(await action({ promptText: '   ' }), /needs a natural-language task/);
});
