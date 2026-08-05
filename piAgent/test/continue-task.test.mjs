import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
    __testables as continuationTestables,
    continueProviderTask,
} from '../scripts/continue-task.mjs';
import { createContinuationHandle } from '../scripts/continuation-store.mjs';
import { spawnTaskSandbox } from '../scripts/task-sandbox.mjs';
import { createContinuationStoreFixture } from './continuation-store-fixture.mjs';

function assistantEvents(text = 'Continued answer') {
    return [
        { type: 'message_start', message: { role: 'assistant', content: [] } },
        {
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', delta: text },
        },
        {
            type: 'message_end',
            message: { role: 'assistant', content: [{ type: 'text', text }] },
        },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n';
}

async function continuationFixture(t, projectDir = '/workspace/projects/alpha') {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-continue-task-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const homePath = path.join(directory, 'provider-home');
    await fs.mkdir(homePath);
    const store = createContinuationStoreFixture({
        homeRoot: homePath,
        storeRoot: path.join(homePath, '.ploinky', 'task-sessions'),
        sessionRoot: path.join(homePath, '.ploinky', 'pi-sessions'),
    });
    const handle = createContinuationHandle();
    store.writeContinuationRecord(handle, { projectDir });
    return { handle, homePath, projectDir, store };
}

function runtimeHarness({
    homePath,
    runtimeKind = 'bwrap',
    beforeValidate = () => {},
    completion = { code: 0, signal: null },
} = {}) {
    const calls = [];
    const state = {
        mode: 'operation',
        resolutions: 0,
        transitions: 0,
        validations: 0,
        spawned: 0,
    };
    const providerRuntime = {
        provider: 'pi',
        get mode() { return state.mode; },
        async resolveHomeState(resolver) {
            state.resolutions += 1;
            return resolver(Object.freeze({ homePath, provider: 'pi', runtimeKind }));
        },
        transitionToTask() {
            state.transitions += 1;
            state.mode = 'task';
            return state.mode;
        },
        async spawnWith(adapter, input, lifecycle) {
            calls.push({ adapter, input, lifecycle });
            beforeValidate();
            await lifecycle.validateAfterLease(Object.freeze({
                provider: 'pi',
                mode: 'task',
                workdir: input.workdir,
                homePath,
                runtimeKind,
            }));
            state.validations += 1;
            state.spawned += 1;
            const stdout = new PassThrough();
            const stderr = new PassThrough();
            let resolveCompletion;
            const completionPromise = new Promise((resolve) => {
                resolveCompletion = resolve;
            });
            setImmediate(() => {
                stdout.end(assistantEvents());
                stderr.end();
                resolveCompletion(completion);
            });
            return Object.freeze({
                child: Object.freeze({ stdout, stderr }),
                launch: Object.freeze({ workdir: input.workdir }),
                completion: completionPromise,
            });
        },
    };
    return { calls, providerRuntime, state };
}

function storeFactory(fixture) {
    return (homePath) => {
        assert.equal(homePath, fixture.homePath);
        return fixture.store;
    };
}

test('PI continuation resolves mode-derived HOME, transitions once, and resumes canonically', async (t) => {
    const fixture = await continuationFixture(t);
    const harness = runtimeHarness({ homePath: fixture.homePath });
    const signal = new AbortController().signal;

    const result = await continuationTestables.continueProviderTaskWithStoreFactory({
        input: {
            handle: fixture.handle,
            prompt: 'Continue the task',
            model: 'plan',
        },
    }, { providerRuntime: harness.providerRuntime, signal }, storeFactory(fixture));

    assert.deepEqual(result, {
        ok: true,
        outputText: 'Continued answer',
        continuation: { version: 1, handle: fixture.handle, toolName: 'continue-task' },
    });
    assert.deepEqual(harness.state, {
        mode: 'task',
        resolutions: 1,
        transitions: 1,
        validations: 1,
        spawned: 1,
    });
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.calls[0].adapter, spawnTaskSandbox);
    assert.equal(harness.calls[0].input.workdir, 'projects/alpha');
    const args = harness.calls[0].input.args;
    assert.equal(args[args.indexOf('--session-id') + 1], fixture.handle);
    assert.equal(
        args[args.indexOf('--session-dir') + 1],
        `/home/agent/.ploinky/pi-sessions/${fixture.handle}`,
    );
    assert.equal(args[args.indexOf('--provider') + 1], 'ploinky-soul');
    assert.equal(args[args.indexOf('--model') + 1], 'plan');
    assert.equal(args.at(-1), 'Continue the task');
    assert.deepEqual(harness.calls[0].lifecycle.environment, {
        PLOINKY_PROVIDER_MODEL: 'plan',
        PLOINKY_PROVIDER_SESSION_ID: fixture.handle,
    });
    assert.deepEqual(harness.calls[0].lifecycle.stdio, ['ignore', 'pipe', 'pipe']);
});

test('PI continuation uses the runtime-selected container HOME without compatibility lookup', async (t) => {
    const fixture = await continuationFixture(t, '/workspace/container-project');
    const harness = runtimeHarness({ homePath: fixture.homePath, runtimeKind: 'container' });

    const result = await continuationTestables.continueProviderTaskWithStoreFactory({
        input: { handle: fixture.handle, prompt: 'Continue in container mode' },
    }, { providerRuntime: harness.providerRuntime }, storeFactory(fixture));

    assert.equal(result.ok, true);
    assert.equal(harness.calls[0].input.workdir, 'container-project');
    assert.equal(harness.state.resolutions, 1);
    assert.equal(harness.state.validations, 1);
});

test('PI continuation rejects a resolver-to-task HOME state race before spawn', async (t) => {
    const fixture = await continuationFixture(t);
    const harness = runtimeHarness({
        homePath: fixture.homePath,
        beforeValidate() {
            fixture.store.writeContinuationRecord(fixture.handle, {
                projectDir: '/workspace/attacker-project',
            });
        },
    });

    const result = await continuationTestables.continueProviderTaskWithStoreFactory({
        input: { handle: fixture.handle, prompt: 'Do not cross projects' },
    }, { providerRuntime: harness.providerRuntime }, storeFactory(fixture));

    assert.equal(result.ok, false);
    assert.equal(result.code, 'PLOINKY_PI_CONTINUATION_MISMATCH');
    assert.equal(harness.state.resolutions, 1);
    assert.equal(harness.state.transitions, 1);
    assert.equal(harness.state.validations, 0);
    assert.equal(harness.state.spawned, 0);
});

test('PI continuation fails closed before transition when state resolution fails', async () => {
    const harness = runtimeHarness({ homePath: '/not-used' });
    const error = Object.assign(new Error('unsafe continuation record'), {
        code: 'unsafe_continuation_record',
    });

    const result = await continuationTestables.continueProviderTaskWithStoreFactory({
        input: { handle: createContinuationHandle(), prompt: 'Do not start' },
    }, { providerRuntime: harness.providerRuntime }, () => ({
        readContinuationRecord() { throw error; },
    }));

    assert.equal(result.ok, false);
    assert.equal(result.code, 'unsafe_continuation_record');
    assert.equal(harness.state.resolutions, 1);
    assert.equal(harness.state.transitions, 0);
    assert.equal(harness.state.spawned, 0);
});

test('PI continuation rejects untrusted grammar and requires the operation runtime', async (t) => {
    const fixture = await continuationFixture(t);
    for (const input of [
        null,
        {},
        { handle: fixture.handle, prompt: 'task', provider: 'openai' },
        { handle: fixture.handle, prompt: ' task ' },
        { handle: fixture.handle, prompt: 'task', model: 3 },
    ]) {
        const harness = runtimeHarness({ homePath: fixture.homePath });
        const result = await continuationTestables.continueProviderTaskWithStoreFactory(
            { input },
            { providerRuntime: harness.providerRuntime },
            storeFactory(fixture),
        );
        assert.equal(result.ok, false);
        assert.equal(result.code, 'PLOINKY_PROVIDER_INPUT_INVALID');
        assert.equal(harness.state.resolutions, 0);
    }

    const result = await continueProviderTask({
        input: { handle: fixture.handle, prompt: 'task' },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PLOINKY_PROVIDER_RUNTIME_REQUIRED');
});

test('PI continuation entry and MCP config contain only the canonical provider path', async () => {
    const source = await fs.readFile(new URL('../scripts/continue-task.mjs', import.meta.url), 'utf8');
    for (const forbidden of [
        '/root',
        'node:child_process',
        'process.env',
        'readStdin',
        'executeTask',
        'readCurrentPiModel',
        'sandboxDependencies',
    ]) {
        assert.equal(source.includes(forbidden), false, forbidden);
    }
    assert.match(source, /providerRuntime\.resolveHomeState/);
    assert.match(source, /providerRuntime\.transitionToTask\(\)/);
    assert.match(
        source,
        /providerRuntime\.spawnWith\(\s*spawnTaskSandbox,\s*\{ workdir: selected\.workdir, args \},/s,
    );

    const config = JSON.parse(await fs.readFile(new URL('../mcp-config.json', import.meta.url), 'utf8'));
    const tool = config.tools.find((entry) => entry.name === 'continue-task');
    assert.deepEqual(tool.providerExecution, {
        provider: 'pi',
        mode: 'operation',
        module: '/code/scripts/continue-task.mjs',
        export: 'continueProviderTask',
    });
    for (const field of ['command', 'args', 'cwd', 'env']) {
        assert.equal(Object.hasOwn(tool, field), false, field);
    }
    assert.equal(Object.hasOwn(tool.inputSchema, 'provider'), false);
});
