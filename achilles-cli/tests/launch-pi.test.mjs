import test from 'node:test';
import assert from 'node:assert/strict';

import { action, HARDCODED_MODEL } from '../src/skills/launch-pi/src/index.mjs';

test('action calls piAgent execute-task with default model', async () => {
    const calls = [];
    const result = await action({
        promptText: 'create a report',
        mainAgent: { startDir: '/workspace/project' },
        agentClient: {
            callTool: async (toolName, payload) => {
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
            callTool: async (toolName, payload) => {
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
            callTool: async (toolName, payload) => {
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

test('action forwards task updates from callback and completes on final response', async () => {
    const progress = [];
    const result = await action({
        promptText: 'create a script',
        progressWriter: { write: (entry) => progress.push(entry) },
        agentClient: {
            callTool: async (_toolName, _payload, { onTaskUpdate }) => {
                onTaskUpdate({
                    status: 'running',
                    logTail: '[pi stdout] first\n',
                    logSeq: 1,
                });
                onTaskUpdate({
                    status: 'completed',
                    logTail: '[pi stdout] first\n[pi stdout] done\n',
                    logSeq: 2,
                });
                return {
                    ok: true,
                    outputText: 'final output',
                };
            },
        },
    });

    assert.equal(result, 'PI task completed.\n\nfinal output');
    assert.equal(progress.length, 2);
    assert.equal(progress[0].tool, 'launch-pi');
    assert.deepEqual(progress.map((entry) => entry.type), ['tool_reason', 'tool_reason']);
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
            callTool: async () => {
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
