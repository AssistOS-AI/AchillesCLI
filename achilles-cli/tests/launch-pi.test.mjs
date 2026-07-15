import test from 'node:test';
import assert from 'node:assert/strict';

import { action, HARDCODED_MODEL } from '../src/skills/launch-pi/src/index.mjs';

test('action calls piAgent execute-task with default model', async () => {
    const calls = [];
    const result = await action({
        promptText: 'create a report',
        mainAgent: { startDir: '/workspace/project' },
        agentClient: {
            callToolWithoutWait: async (toolName, payload) => {
                calls.push({ toolName, payload });
                return { ok: true, projectDir: payload.projectDir, model: payload.model };
            },
        },
    });

    assert.equal(result, 'PI task completed.');
    assert.deepEqual(calls, [{
        toolName: 'execute-task',
        payload: {
            prompt: 'create a report',
            projectDir: '/workspace/project',
            model: HARDCODED_MODEL,
        },
    }]);
});

test('action accepts JSON input with prompt and model override', async () => {
    const result = await action({
        promptText: JSON.stringify({
            prompt: 'build a component',
            model: 'override/model',
        }),
        agentClient: {
            callToolWithoutWait: async (toolName, payload) => {
                assert.equal(toolName, 'execute-task');
                assert.equal(payload.model, 'override/model');
                return { ok: true, outputText: 'ok' };
            },
        },
    });

    assert.equal(result, 'PI task completed.\n\nok');
});

test('action accepts text input with model and task fields', async () => {
    const calls = [];
    const result = await action({
        promptText: 'model: claude-test task: build a component: keep it small',
        agentClient: {
            callToolWithoutWait: async (toolName, payload) => {
                calls.push({ toolName, payload });
                return { ok: true, outputText: 'ok' };
            },
        },
    });

    assert.equal(result, 'PI task completed.\n\nok');
    assert.equal(calls[0].toolName, 'execute-task');
    assert.equal(calls[0].payload.model, 'claude-test');
    assert.equal(calls[0].payload.prompt, 'build a component: keep it small');
});

test('action uses the non-blocking client path without callback polling', async () => {
    let capturedOptions = null;
    const result = await action({
        promptText: 'create a script',
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

    assert.equal(result, 'PI task completed.\n\nfinal output');
    assert.equal(capturedOptions.onTaskUpdate, undefined);
});

test('action reports failed async task as plain text', async () => {
    const failed = new Error('failed task');
    failed.task = {
        error: 'pi failed in queue',
        logTail: '[pi stderr] details\n',
        status: 'failed',
    };

    const result = await action({
        promptText: 'create a script',
        agentClient: {
            callToolWithoutWait: async () => {
                throw failed;
            },
        },
    });

    assert.equal(result, 'PI task failed: pi failed in queue\n\n[pi stderr] details');
});

test('action returns plain text for missing prompt', async () => {
    const result = await action({ promptText: '   ' });

    assert.match(result, /needs a natural-language task/);
});
