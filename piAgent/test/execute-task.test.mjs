import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
    __testables as piRunnerTestables,
    createPiJsonEventParser,
    executeProviderTask,
} from '../scripts/execute-task.mjs';
import {
    createContinuationStoreFixture,
} from './continuation-store-fixture.mjs';
import { spawnTaskSandbox } from '../scripts/task-sandbox.mjs';

function assistantEvents({ error = '' } = {}) {
    if (error) {
        return `${JSON.stringify({
            type: 'message_end',
            message: {
                role: 'assistant',
                content: [],
                stopReason: 'error',
                errorMessage: error,
                diagnostics: [{ error: { message: 'hidden transport detail' } }],
            },
        })}\n`;
    }
    return [
        { type: 'session', id: 'hidden-session-metadata' },
        { type: 'message_start', message: { role: 'assistant', content: [] } },
        {
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', delta: 'Pi ' },
        },
        {
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', delta: 'answer' },
        },
        {
            type: 'message_end',
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'Pi answer', textSignature: 'hidden' }],
            },
        },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n';
}

function runtimeHarness({
    stdout = assistantEvents(),
    stderr = '',
    completion = { code: 0, signal: null },
    spawnError = null,
    beforeAfterExit = () => {},
    completeBeforeReturn = false,
} = {}) {
    const calls = [];
    const state = { afterExitCalls: 0, completionResolved: false, leaseHeld: false };
    const providerRuntime = {
        provider: 'pi',
        mode: 'task',
        async spawnWith(adapter, input, lifecycle) {
            calls.push({ adapter, input, lifecycle });
            if (spawnError) throw spawnError;
            const childStdout = new PassThrough();
            const childStderr = new PassThrough();
            let settle;
            const completionPromise = new Promise((resolve, reject) => {
                settle = async () => {
                    if (completion instanceof Error) {
                        state.leaseHeld = false;
                        state.completionResolved = true;
                        reject(completion);
                        return;
                    }
                    try {
                        beforeAfterExit();
                        const afterExit = lifecycle.afterExit
                            ? await lifecycle.afterExit({
                                code: completion.code,
                                signal: completion.signal,
                                launch: { workdir: input.workdir },
                            })
                            : undefined;
                        if (lifecycle.afterExit) state.afterExitCalls += 1;
                        state.leaseHeld = false;
                        state.completionResolved = true;
                        resolve({ ...completion, ...(lifecycle.afterExit ? { afterExit } : {}) });
                    } catch (error) {
                        state.leaseHeld = false;
                        state.completionResolved = true;
                        reject(error);
                    }
                };
            });
            state.leaseHeld = true;
            const complete = async () => {
                childStdout.end(stdout);
                childStderr.end(stderr);
                await settle();
            };
            if (completeBeforeReturn) await complete();
            else setImmediate(complete);
            return Object.freeze({
                child: Object.freeze({ stdout: childStdout, stderr: childStderr }),
                launch: Object.freeze({ workdir: input.workdir }),
                completion: completionPromise,
            });
        },
    };
    return { calls, providerRuntime, state };
}

async function temporaryStore(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-provider-task-test-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const homeRoot = path.join(directory, 'home');
    const storeRoot = path.join(homeRoot, '.ploinky', 'continuations');
    const sessionRoot = path.join(homeRoot, '.ploinky', 'sessions');
    await fs.mkdir(homeRoot);
    return {
        directory,
        sessionRoot,
        storeRoot,
        store: createContinuationStoreFixture({ homeRoot, storeRoot, sessionRoot }),
    };
}

test('PI JSON parser emits readable text without lifecycle metadata or duplicates', () => {
    let visible = '';
    const parser = createPiJsonEventParser({ onText: (text) => { visible += text; } });
    const lines = [
        JSON.stringify({
            type: 'tool_execution_update',
            toolCallId: 'tool-1',
            partialResult: { content: [{ type: 'text', text: 'first' }] },
        }),
        JSON.stringify({
            type: 'tool_execution_end',
            toolCallId: 'tool-1',
            result: { content: [{ type: 'text', text: 'first\nsecond\n' }] },
        }),
        assistantEvents().trim(),
    ].join('\n') + '\n';
    const splitAt = lines.indexOf('first') + 2;
    parser.push(Buffer.from(lines.slice(0, splitAt)));
    parser.push(Buffer.from(lines.slice(splitAt)));
    parser.finish();

    assert.equal(visible, 'first\nsecond\nPi answer');
    assert.equal(parser.getFinalOutputText(), 'Pi answer');
    assert.doesNotMatch(visible, /hidden|session|signature/i);
});

test('PI JSON parser captures assistant errors without leaking diagnostics', () => {
    let visible = '';
    const parser = createPiJsonEventParser({ onText: (text) => { visible += text; } });
    parser.push(Buffer.from(assistantEvents({ error: 'Authentication failed.' })));
    parser.finish();

    assert.equal(visible, '');
    assert.equal(parser.getFinalOutputText(), '');
    assert.equal(parser.getErrorMessage(), 'Authentication failed.');
});

test('PI retained output is byte bounded', () => {
    const retained = piRunnerTestables.appendBoundedTail('', '€'.repeat(20_000));
    assert.ok(Buffer.byteLength(retained, 'utf8') <= 16 * 1024);
    assert.match(retained, /€+$/u);
});

test('PI provider task launches only through the trusted runtime and preserves result shape', async (t) => {
    const { sessionRoot, store } = await temporaryStore(t);
    let continuationWrites = 0;
    const { calls, providerRuntime, state } = runtimeHarness({
        beforeAfterExit() {
            assert.equal(
                continuationWrites,
                0,
                'untrusted PI must exit before trusted continuation state is accessed',
            );
        },
    });
    const signal = new AbortController().signal;
    const leaseCheckedStore = {
        writeContinuationRecord(...args) {
            assert.equal(state.leaseHeld, true, 'continuation state must be accessed under HOME lease');
            continuationWrites += 1;
            return store.writeContinuationRecord(...args);
        },
    };

    const result = await piRunnerTestables.executeProviderTaskWithStore({
        tool: 'execute-task',
        taskId: 'task-1',
        input: {
            prompt: 'Do the task',
            projectDir: 'project with spaces',
            model: 'deep',
        },
    }, { providerRuntime, signal }, leaseCheckedStore);

    assert.equal(result.ok, true);
    assert.equal(result.outputText, 'Pi answer');
    assert.equal(result.continuation.toolName, 'continue-task');
    assert.match(result.continuation.handle, /^[0-9a-f-]{36}$/i);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].adapter, spawnTaskSandbox);
    assert.deepEqual(Object.keys(calls[0].input).sort(), ['args', 'workdir']);
    assert.equal(calls[0].input.workdir, 'project with spaces');
    const args = calls[0].input.args;
    assert.deepEqual(args.slice(0, 6), [
        '--mode',
        'json',
        '--session-id',
        result.continuation.handle,
        '--session-dir',
        `/home/agent/.ploinky/pi-sessions/${result.continuation.handle}`,
    ]);
    assert.equal(args[args.indexOf('--extension') + 1], '/code/extensions/ploinky-soul.mjs');
    assert.equal(args[args.indexOf('--provider') + 1], 'ploinky-soul');
    assert.equal(args[args.indexOf('--model') + 1], 'deep');
    assert.equal(args.at(-1), 'Do the task');
    assert.equal(typeof calls[0].lifecycle.afterExit, 'function');
    assert.deepEqual(calls[0].lifecycle.environment, {
        PLOINKY_PROVIDER_MODEL: 'deep',
        PLOINKY_PROVIDER_SESSION_ID: result.continuation.handle,
    });
    assert.deepEqual(calls[0].lifecycle.stdio, ['ignore', 'pipe', 'pipe']);
    assert.equal(state.afterExitCalls, 1);
    assert.equal(continuationWrites, 1);
    assert.equal(state.completionResolved, true);
    assert.equal(state.leaseHeld, false);
    const record = store.readContinuationRecord(result.continuation.handle);
    assert.equal(record.projectDir, '/workspace/project with spaces');
    assert.equal(record.sessionDir, path.join(sessionRoot, result.continuation.handle));
});

test('PI fast exit persists continuation before the canonical handle is returned', async (t) => {
    const { store } = await temporaryStore(t);
    const harness = runtimeHarness({ completeBeforeReturn: true });
    const result = await piRunnerTestables.executeProviderTaskWithStore({
        input: { prompt: 'Finish immediately', projectDir: 'project' },
    }, { providerRuntime: harness.providerRuntime }, store);

    assert.equal(result.ok, true);
    assert.equal(harness.state.afterExitCalls, 1);
    assert.equal(store.readContinuationRecord(result.continuation.handle).projectDir, '/workspace/project');
});

test('PI provider failures and cancellation keep the preallocated continuation', async (t) => {
    for (const fixture of [
        {
            harness: runtimeHarness({ stderr: 'insufficient credits', completion: { code: 1, signal: null } }),
            error: /exit code 1/,
            outputText: 'insufficient credits',
        },
        {
            harness: runtimeHarness({ completion: { code: null, signal: 'SIGTERM' } }),
            error: /signal SIGTERM/,
            outputText: 'Pi answer',
        },
        {
            harness: runtimeHarness({
                stdout: assistantEvents({ error: 'Authentication failed.' }),
                completion: { code: 0, signal: null },
            }),
            error: /Authentication failed/,
            outputText: '',
        },
    ]) {
        const { store } = await temporaryStore(t);
        const result = await piRunnerTestables.executeProviderTaskWithStore({
            input: { prompt: 'Try provider', projectDir: 'project' },
        }, { providerRuntime: fixture.harness.providerRuntime }, store);
        assert.equal(result.ok, false);
        assert.match(result.error, fixture.error);
        assert.equal(result.outputText, fixture.outputText);
        assert.equal(store.readContinuationRecord(result.continuation.handle).projectDir, '/workspace/project');
    }
});

test('PI task rejects untrusted grammar and spawn failure before continuation mutation', async (t) => {
    const { store, storeRoot, sessionRoot } = await temporaryStore(t);
    const spawnError = Object.assign(new Error('helper unavailable'), {
        code: 'PLOINKY_PROVIDER_HELPER_UNAVAILABLE',
    });
    const failed = runtimeHarness({ spawnError });
    const spawnResult = await piRunnerTestables.executeProviderTaskWithStore({
        input: { prompt: 'Do not run', projectDir: 'project' },
    }, { providerRuntime: failed.providerRuntime }, store);
    assert.equal(spawnResult.ok, false);
    assert.equal(spawnResult.code, 'PLOINKY_PROVIDER_HELPER_UNAVAILABLE');
    assert.equal(Object.hasOwn(spawnResult, 'continuation'), false);
    await assert.rejects(fs.access(storeRoot));
    await assert.rejects(fs.access(sessionRoot));

    for (const input of [
        null,
        {},
        { prompt: 'task', projectDir: 'project', provider: 'anthropic' },
        { prompt: 'task', projectDir: ' project ' },
        { prompt: 'task', projectDir: 'project', model: 3 },
    ]) {
        const harness = runtimeHarness();
        const result = await piRunnerTestables.executeProviderTaskWithStore(
            { input },
            { providerRuntime: harness.providerRuntime },
            store,
        );
        assert.equal(result.ok, false);
        assert.equal(result.code, 'PLOINKY_PROVIDER_INPUT_INVALID');
        assert.equal(harness.calls.length, 0);
    }
    const missingRuntime = await executeProviderTask({
        input: { prompt: 'task', projectDir: 'project' },
    });
    assert.equal(missingRuntime.ok, false);
    assert.equal(missingRuntime.code, 'PLOINKY_PROVIDER_RUNTIME_REQUIRED');
});

test('PI task entry and MCP config have no shell, broker, env, or legacy fallback', async () => {
    const source = await fs.readFile(new URL('../scripts/execute-task.mjs', import.meta.url), 'utf8');
    for (const forbidden of [
        '/root',
        'node:child_process',
        'startScopedSoulBroker',
        'prepareTaskSandbox',
        'buildTaskSandboxLaunch',
        'process.env',
        'PI_BIN',
        'sandboxDependencies',
        'readStdin',
        'createProjectDir',
    ]) {
        assert.equal(source.includes(forbidden), false, forbidden);
    }
    assert.match(
        source,
        /providerRuntime\.spawnWith\(\s*spawnTaskSandbox,\s*\{ workdir: input\.workdir, args \},/s,
    );

    const config = JSON.parse(await fs.readFile(new URL('../mcp-config.json', import.meta.url), 'utf8'));
    assert.deepEqual(config.providerSandbox, { provider: 'pi', readiness: true });
    const execute = config.tools.find((tool) => tool.name === 'execute-task');
    assert.deepEqual(execute.providerExecution, {
        provider: 'pi',
        mode: 'task',
        module: '/code/scripts/execute-task.mjs',
        export: 'executeProviderTask',
    });
    assert.equal(execute.async, true);
    for (const field of ['command', 'args', 'cwd', 'env']) {
        assert.equal(Object.hasOwn(execute, field), false, field);
    }
});
