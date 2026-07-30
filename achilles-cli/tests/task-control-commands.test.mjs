import assert from 'node:assert/strict';
import test from 'node:test';

import { createTaskControlCommands } from '../src/lib/taskControlCommands.mjs';
import { createWebchatInteractionController } from '../src/lib/webchatInteractionController.mjs';

const TASK_ID = 'task_111111111111111111111111';

test('/task model returns the agent endpoint catalog without creating an interaction', async () => {
    const calls = [];
    const interactions = {
        async select(request) {
            throw new Error(`unexpected select: ${request.title}`);
        },
        async input() { throw new Error('unexpected input'); },
    };
    const control = async (input) => {
        calls.push(['control', input]);
        if (input.operation === 'list_models') {
            return { type: 'task-model-catalog', models: [{ key: 'openai/gpt-test', label: 'GPT Test' }] };
        }
        return { model: { key: input.modelKey, label: 'GPT Test' } };
    };
    const commands = createTaskControlCommands({
        workingDir: '/work',
        interactions,
        controlTaskSessionImpl: control,
    });

    const result = await commands.model(TASK_ID, '', { context: { sourceTabId: 'tab_model' } });
    assert.equal(result.type, 'task-model-catalog');
    assert.equal(result.models[0].key, 'openai/gpt-test');
    assert.deepEqual(calls.filter(([kind]) => kind === 'control').map(([, input]) => input.operation), [
        'list_models',
    ]);
    assert.equal(calls.some(([kind]) => kind === 'select'), false);
});

test('/task model validates the catalog and persists an explicit model key', async () => {
    const operations = [];
    const commands = createTaskControlCommands({
        workingDir: '/work',
        interactions: {
            async select() { throw new Error('unexpected select'); },
            async input() { throw new Error('unexpected input'); },
        },
        controlTaskSessionImpl: async (input) => {
            operations.push(input.operation);
            if (input.operation === 'list_models') {
                return { type: 'task-model-catalog', models: [{ key: 'openai/gpt-test', label: 'GPT Test' }] };
            }
            return { model: { key: input.modelKey, label: 'GPT Test' } };
        },
    });

    const result = await commands.model(TASK_ID, 'openai/gpt-test');
    assert.equal(result.model.key, 'openai/gpt-test');
    assert.deepEqual(operations, ['list_models', 'set_model']);
});

test('/task login owns provider and secret prompting in AchillesCLI', async () => {
    const calls = [];
    const interactions = {
        async select(request) {
            calls.push(['select', request.title]);
            if (request.title === 'Connect provider') return 'openai';
            return 'api_key';
        },
        async input(request) {
            calls.push(['input', request.type]);
            assert.equal(request.targetTaskId, TASK_ID);
            assert.equal(request.targetTabId, 'tab_login');
            return 'secret-value';
        },
    };
    const control = async (input) => {
        calls.push(['control', input]);
        if (input.operation === 'login_describe') {
            return {
                providers: [{
                    key: 'openai',
                    label: 'OpenAI',
                    methods: [{ key: 'api_key', label: 'API key', secret: true }],
                }],
            };
        }
        return { status: 'completed', provider: input.provider };
    };
    const commands = createTaskControlCommands({
        workingDir: '/work',
        interactions,
        controlTaskSessionImpl: control,
    });

    const result = await commands.login(TASK_ID, '', '', { context: { sourceTabId: 'tab_login' } });
    assert.equal(result.status, 'completed');
    assert.deepEqual(calls.filter(([kind]) => kind === 'input'), [['input', 'secret']]);
    const start = calls.find(([kind, input]) => kind === 'control' && input.operation === 'login_start')[1];
    assert.equal(start.apiKey, 'secret-value');
});

test('generic interaction controller maps opaque option ids back to Achilles values', async () => {
    const writes = [];
    const controller = createWebchatInteractionController({
        stdout: { write: (value) => writes.push(JSON.parse(value)) },
        timeoutMs: 1000,
    });
    const pending = controller.select({
        title: 'Choose model',
        options: [{ value: 'openai/gpt-test', label: 'GPT Test' }],
        searchable: true,
        targetTaskId: TASK_ID,
        targetTabId: 'tab_model',
    });
    const request = writes[0];
    assert.equal(request.kind, 'select');
    assert.equal(request.options[0].id, 'choice_0');
    assert.equal(request.options[0].value, undefined);
    assert.equal(request.targetTaskId, TASK_ID);
    assert.equal(request.targetTabId, 'tab_model');
    assert.equal(controller.resolve({ id: request.id, optionId: 'choice_0' }), true);
    assert.equal(await pending, 'openai/gpt-test');
    controller.dispose();
});
