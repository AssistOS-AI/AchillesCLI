import test from 'node:test';
import assert from 'node:assert/strict';

import { action, TARGET_AGENT_REF } from '../src/skills/launch-pi/src/index.mjs';

test('action lets piAgent select its model when no override is provided', async () => {
    const calls = [];
    const starts = [];
    const result = await action({
        promptText: 'create a report',
        mainAgent: { startDir: '/workspace/project' },
        agentClient: {
            ensureAgentRunning: async (agentRef, options) => starts.push({ agentRef, options }),
            callToolWithoutWait: async (toolName, payload) => {
                calls.push({ toolName, payload });
                return { ok: true, projectDir: payload.projectDir, model: payload.model };
            },
        },
    });

    assert.equal(result, 'PI task completed.');
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

test('action treats JSON-shaped text as the literal task', async () => {
    const task = JSON.stringify({
        prompt: 'build a component',
        model: 'override/model',
    });
    const result = await action({
        promptText: task,
        mainAgent: { startDir: '/workspace/project' },
        agentClient: {
            callToolWithoutWait: async (toolName, payload) => {
                assert.equal(toolName, 'execute-task');
                assert.equal(payload.model, undefined);
                assert.equal(payload.prompt, task);
                return { ok: true, outputText: 'ok' };
            },
        },
    });

    assert.equal(result, 'PI task completed.\n\nok');
});

test('action treats model-shaped text as the literal task and ignores invocation.model', async () => {
    const calls = [];
    const result = await action({
        promptText: 'model: claude-test task: build a component: keep it small',
        model: 'fast',
        mainAgent: { startDir: '/workspace/project' },
        agentClient: {
            callToolWithoutWait: async (toolName, payload) => {
                calls.push({ toolName, payload });
                return { ok: true, outputText: 'ok' };
            },
        },
    });

    assert.equal(result, 'PI task completed.\n\nok');
    assert.equal(calls[0].toolName, 'execute-task');
    assert.equal(calls[0].payload.model, undefined);
    assert.equal(calls[0].payload.prompt, 'model: claude-test task: build a component: keep it small');
});

test('action uses the non-blocking client path without callback polling', async () => {
    let capturedOptions = null;
    const result = await action({
        promptText: 'create a script',
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
        mainAgent: { startDir: '/workspace/project' },
        agentClient: {
            callToolWithoutWait: async () => {
                throw failed;
            },
        },
    });

    assert.equal(result, 'PI task failed: pi failed in queue\n\n[pi stderr] details');
});

test('action surfaces allowlisted lifecycle codes without diagnostic leakage', async () => {
    const result = await action({
        promptText: 'create a script',
        mainAgent: { startDir: '/workspace/project' },
        agentClient: {
            callToolWithoutWait: async () => ({
                ok: false,
                code: 'PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE',
                error: 'probe failed: command --secret provider-token',
                logTail: 'PLOINKY_MASTER_KEY=hidden',
            }),
        },
    });

    assert.equal(
        result,
        'PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE: The delegated task sandbox capability is unavailable.',
    );
    assert.doesNotMatch(result, /secret|provider-token|MASTER_KEY/);
});

test('action surfaces a safe code reconstructed on a thrown lifecycle error', async () => {
    const error = new Error('internal runtime detail');
    error.code = 'PLOINKY_BOX_RUNTIME_CAPABILITY_UNSUPPORTED';
    const result = await action({
        promptText: 'create a script',
        mainAgent: { startDir: '/workspace/project' },
        agentClient: { callToolWithoutWait: async () => { throw error; } },
    });

    assert.equal(
        result,
        'PI task failed: PLOINKY_BOX_RUNTIME_CAPABILITY_UNSUPPORTED: The Box runtime does not support the required capability.',
    );
});

test('action requires an explicit non-root workdir before target-agent side effects', async () => {
    for (const [mainAgent, expectedCode] of [
        [undefined, 'PLOINKY_WORKDIR_REQUIRED'],
        [{ startDir: '/workspace' }, 'PLOINKY_WORKDIR_ROOT_FORBIDDEN'],
    ]) {
        let called = false;
        const result = await action({
            promptText: 'build',
            mainAgent,
            agentClient: { callToolWithoutWait: async () => { called = true; } },
        });
        assert.match(result, new RegExp(`PI task failed: ${expectedCode}:`));
        assert.equal(called, false);
    }
});

test('action returns plain text for missing prompt', async () => {
    const result = await action({ promptText: '   ' });

    assert.match(result, /needs a natural-language task/);
});
