import assert from 'node:assert/strict';
import test from 'node:test';

import { controlTaskSession } from '../src/lib/taskSessionControl.mjs';

const TASK = {
    id: 'task_111111111111111111111111',
    targetAgent: 'piAgent',
    status: 'finished',
    continuation: { handle: 'opaque-task-handle', toolName: 'continue-task' },
};

test('task control lists endpoint models and stores only the server-selected execution arguments', async () => {
    const calls = [];
    const clientModule = {
        async createAgentClient(agent) {
            calls.push(['client', agent]);
            return {
                async ensureAgentRunning(target, options) { calls.push(['ensure', target, options]); },
                async getModels() {
                    return {
                        object: 'list',
                        data: [{
                            id: 'pi/gpt-test',
                            displayName: 'GPT Test',
                            execution: { provider: 'pi', model: 'gpt-test' },
                        }],
                    };
                },
            };
        },
    };
    let stored = null;
    const result = await controlTaskSession({
        dir: '/work',
        taskId: TASK.id,
        operation: 'set_model',
        modelKey: 'pi/gpt-test',
        model: 'client-must-not-control-this',
    }, {
        clientModule,
        getTaskImpl: () => TASK,
        setTaskModelImpl: (_dir, _taskId, selection) => {
            stored = selection;
            return {
                ...TASK,
                execution: { model: selection },
                logAppend: 'switched model to: GPT Test\n',
                logOffset: 28,
            };
        },
    });
    assert.deepEqual(stored, {
        key: 'pi/gpt-test',
        provider: 'pi',
        model: 'gpt-test',
        label: 'GPT Test',
        description: 'pi',
    });
    assert.equal(result.model.model, 'gpt-test');
    assert.equal(result.logAppend, 'switched model to: GPT Test\n');
    assert.equal(result.logOffset, 28);
    assert.deepEqual(calls, [
        ['client', 'piAgent'],
        ['ensure', 'piAgent', { mode: 'global' }],
    ]);
});

test('task control rejects arbitrary operations before invoking the target tool', async () => {
    let called = false;
    await assert.rejects(() => controlTaskSession({
        dir: '/work',
        taskId: TASK.id,
        operation: 'execute_command',
    }, {
        getTaskImpl: () => TASK,
        clientModule: {
            async createAgentClient() {
                return {
                    async ensureAgentRunning() {},
                    async callTool() { called = true; },
                };
            },
        },
    }), /unsupported_task_control_operation/);
    assert.equal(called, false);
});

test('task login starts a stopped target agent before invoking its internal adapter', async () => {
    const calls = [];
    const result = await controlTaskSession({
        dir: '/work',
        taskId: TASK.id,
        operation: 'login_describe',
    }, {
        getTaskImpl: () => TASK,
        clientModule: {
            async createAgentClient() {
                return {
                    async ensureAgentRunning(agent, options) { calls.push(['ensure', agent, options]); },
                    async callTool(tool, input) {
                        calls.push(['tool', tool, input]);
                        return { content: [{ type: 'text', text: '{"providers":[]}' }] };
                    },
                };
            },
        },
    });
    assert.deepEqual(result, { providers: [] });
    assert.deepEqual(calls, [
        ['ensure', 'piAgent', { mode: 'global' }],
        ['tool', 'task-session-control', {
            operation: 'login_describe',
            handle: 'opaque-task-handle',
        }],
    ]);
});

test('task login controls forward only the exact retained-session capability grammar', async () => {
    const toolInputs = [];
    const dependencies = {
        getTaskImpl: () => TASK,
        clientModule: {
            async createAgentClient() {
                return {
                    async ensureAgentRunning() {},
                    async callTool(_tool, input) {
                        toolInputs.push(input);
                        return { content: [{ type: 'text', text: '{"status":"running"}' }] };
                    },
                };
            },
        },
    };
    const flowId = 'login:11111111-2222-4333-8444-555555555555';
    const continuationHandle = 'c'.repeat(43);
    const nonce = 'n'.repeat(16);

    await controlTaskSession({
        dir: '/work', taskId: TASK.id, operation: 'login_status',
        flowId, continuationHandle,
    }, dependencies);
    await controlTaskSession({
        dir: '/work', taskId: TASK.id, operation: 'login_respond',
        flowId, continuationHandle, seq: 2, nonce, response: 'one-use-code',
    }, dependencies);
    await controlTaskSession({
        dir: '/work', taskId: TASK.id, operation: 'login_cancel',
        flowId, continuationHandle,
    }, dependencies);

    assert.deepEqual(toolInputs, [{
        operation: 'login_status', flowId, continuationHandle,
    }, {
        operation: 'login_respond', flowId, continuationHandle,
        seq: 2, nonce, response: 'one-use-code',
    }, {
        operation: 'login_cancel', flowId, continuationHandle,
    }]);
    assert.equal(JSON.stringify(toolInputs).includes('opaque-task-handle'), false);
    assert.equal(JSON.stringify(toolInputs).includes('secretResponse'), false);
});

test('task login rejects malformed capability and oversized response before target invocation', async () => {
    let invoked = false;
    let clientCreated = false;
    const dependencies = {
        getTaskImpl: () => TASK,
        clientModule: {
            async createAgentClient() {
                clientCreated = true;
                return {
                    async ensureAgentRunning() {},
                    async callTool() { invoked = true; },
                };
            },
        },
    };
    await assert.rejects(controlTaskSession({
        dir: '/work', taskId: TASK.id, operation: 'login_status',
        flowId: 'login:not-a-uuid', continuationHandle: 'c'.repeat(43),
    }, dependencies), /invalid_provider_login_flow/);
    await assert.rejects(controlTaskSession({
        dir: '/work', taskId: TASK.id, operation: 'login_respond',
        flowId: 'login:11111111-2222-4333-8444-555555555555',
        continuationHandle: 'c'.repeat(43),
        seq: 1,
        nonce: 'n'.repeat(16),
        response: 'x'.repeat((8 * 1024) + 1),
    }, dependencies), /invalid_provider_login_response/);
    assert.equal(invoked, false);
    assert.equal(clientCreated, false);
});
