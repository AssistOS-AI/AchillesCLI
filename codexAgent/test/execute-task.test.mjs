import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
    buildCodexArgs,
    eventLogText,
    executeCodexTask,
} from '../scripts/codex-runner.mjs';
import { executeProviderTask, __testables as executeTestables } from '../scripts/execute-task.mjs';
import { continueProviderTask, __testables as continueTestables } from '../scripts/continue-task.mjs';
import {
    selectContinuationRecordFromHome,
    __testables as continuationStoreTestables,
} from '../scripts/continuation-store.mjs';

const THREAD_ID = '018f6f4a-4ec8-7d31-a852-0242ac120002';

function providerRuntime({
    code = 0,
    signal = null,
    threadId = THREAD_ID,
    agentMessage = 'final answer\n',
    commandOutput = 'command output\n',
    stderr = 'provider stderr\n',
    launchWorkdir = 'projects/example',
    abortSignal,
    leaseState,
} = {}) {
    const calls = [];
    return {
        calls,
        async spawnWith(adapter, input, lifecycle) {
            calls.push({ adapter, input, lifecycle });
            const child = new EventEmitter();
            child.stdout = new PassThrough();
            child.stderr = new PassThrough();
            child.kill = () => true;
            const launch = {
                helper: '/usr/local/libexec/ploinky-bwrap-launch',
                provider: 'codex',
                mode: 'task',
                workdir: launchWorkdir,
                cwd: `/workspace/${launchWorkdir}`,
            };
            lifecycle.observeProcess?.(child);
            const completion = new Promise((resolve, reject) => {
                setImmediate(async () => {
                    try {
                        child.stdout.write(`${JSON.stringify({ type: 'thread.started', thread_id: threadId })}\n`);
                        child.stdout.write(`${JSON.stringify({
                            type: 'item.completed',
                            item: { type: 'command_execution', aggregated_output: commandOutput },
                        })}\n`);
                        child.stdout.write(`${JSON.stringify({
                            type: 'item.completed',
                            item: { type: 'agent_message', text: agentMessage },
                        })}\n`);
                        child.stderr.end(stderr);
                        child.stdout.end();
                        const terminal = {
                            code: abortSignal?.aborted ? null : code,
                            signal: abortSignal?.aborted ? 'SIGTERM' : signal,
                        };
                        await lifecycle.afterExit?.({ ...terminal, launch });
                        if (leaseState) leaseState.held = false;
                        resolve(terminal);
                    } catch (error) {
                        if (leaseState) leaseState.held = false;
                        reject(error);
                    }
                });
            });
            return {
                child,
                completion,
                launch,
            };
        },
    };
}

function continuationProviderRuntime({
    order = [],
    homePath = '/home/agent',
    runtimeKind = 'bwrap',
    validationOverrides = {},
    resolverError,
    transitionError,
    ...taskOptions
} = {}) {
    const taskRuntime = providerRuntime(taskOptions);
    let resolved = false;
    let transitioned = false;
    return {
        calls: taskRuntime.calls,
        async resolveHomeState(resolver) {
            order.push('resolve:start');
            if (resolverError) throw resolverError;
            const value = await resolver({ homePath, provider: 'codex', runtimeKind });
            resolved = true;
            order.push('resolve:end');
            return value;
        },
        transitionToTask() {
            order.push('transition');
            if (transitionError) throw transitionError;
            assert.equal(resolved, true);
            transitioned = true;
            return 'task';
        },
        async spawnWith(adapter, input, lifecycle) {
            order.push('spawn:start');
            assert.equal(transitioned, true);
            await lifecycle.validateAfterLease({
                homePath,
                provider: 'codex',
                runtimeKind,
                mode: 'task',
                workdir: 'projects/example',
                ...validationOverrides,
            });
            order.push('spawn:validated');
            return taskRuntime.spawnWith(adapter, input, lifecycle);
        },
    };
}

test('Codex initial arguments retain native defense in depth and an optional initial model', () => {
    assert.deepEqual(buildCodexArgs({
        prompt: 'Build this.',
        model: 'gpt-initial',
    }), [
        '--sandbox',
        'workspace-write',
        '--ask-for-approval',
        'never',
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--model',
        'gpt-initial',
        'Build this.',
    ]);
});

test('Codex continuation never accepts a model override', () => {
    assert.deepEqual(buildCodexArgs({
        prompt: 'Continue.',
        threadId: 'thread-1',
    }), [
        '--sandbox',
        'workspace-write',
        '--ask-for-approval',
        'never',
        'exec',
        'resume',
        '--json',
        '--skip-git-repo-check',
        'thread-1',
        'Continue.',
    ]);
    assert.throws(
        () => buildCodexArgs({ prompt: 'Continue.', threadId: 'thread-1', model: 'stale-model' }),
        (error) => error?.code === 'PLOINKY_PROVIDER_INPUT_INVALID',
    );
});

test('Codex continuation storage derives only from the explicit runtime HOME', () => {
    assert.equal(
        continuationStoreTestables.storeDirectory({ HOME: '/home/agent' }),
        '/home/agent/.ploinky/task-sessions',
    );
    assert.equal(
        continuationStoreTestables.storeDirectory({ HOME: '/root' }),
        '/root/.ploinky/task-sessions',
    );
    assert.equal(
        continuationStoreTestables.storeDirectory({
            HOME: '/home/agent',
            PLOINKY_CONTINUATION_STORE_DIR: '/private/test-store',
        }),
        '/private/test-store',
    );
    assert.throws(
        () => continuationStoreTestables.storeDirectory({}),
        /explicit runtime HOME/u,
    );
});

test('Codex trusted continuation selection is explicit-HOME-only, bounded, and symlink rejecting', async (t) => {
    const handle = '2a9a13fb-8442-45d3-b7a7-af5a2335049e';
    const homePath = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-continuation-home-'));
    t.after(() => fs.rm(homePath, { recursive: true, force: true }));
    const directory = path.join(homePath, '.ploinky', 'task-sessions');
    const filePath = path.join(directory, `${handle}.json`);
    const record = {
        version: 1,
        provider: 'codex',
        threadId: THREAD_ID,
        projectDir: '/workspace/projects/example',
        createdAt: '2026-08-05T10:00:00.000Z',
        updatedAt: '2026-08-05T10:00:01.000Z',
    };
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(filePath, `${JSON.stringify(record)}\n`, { mode: 0o600 });

    assert.deepEqual(selectContinuationRecordFromHome(homePath, handle), {
        handle,
        threadId: THREAD_ID,
        projectDir: '/workspace/projects/example',
    });

    await fs.writeFile(filePath, JSON.stringify({ ...record, legacyPath: '/tmp/project' }));
    assert.throws(
        () => selectContinuationRecordFromHome(homePath, handle),
        /invalid_continuation_record/u,
    );

    await fs.writeFile(filePath, 'x'.repeat(continuationStoreTestables.MAX_RECORD_BYTES + 1));
    assert.throws(
        () => selectContinuationRecordFromHome(homePath, handle),
        /unsafe_continuation_record/u,
    );

    const targetPath = path.join(homePath, 'attacker-record.json');
    await fs.writeFile(targetPath, JSON.stringify(record));
    await fs.unlink(filePath);
    await fs.symlink(targetPath, filePath);
    assert.throws(
        () => selectContinuationRecordFromHome(homePath, handle),
        /unsafe_continuation_record/u,
    );
});

test('Codex continuation records accept only canonical selected workspace paths', () => {
    assert.equal(
        continuationStoreTestables.normalizeProjectDir('/workspace/projects/project with spaces'),
        '/workspace/projects/project with spaces',
    );
    for (const value of [
        '/workspace',
        '/workspace/',
        '/workspace/projects/../sibling',
        '/tmp/legacy-project',
        'projects/relative',
    ]) {
        assert.throws(
            () => continuationStoreTestables.normalizeProjectDir(value),
            /invalid_continuation_record/u,
        );
    }
});

test('eventLogText exposes provider text without synthetic decoration', () => {
    assert.equal(eventLogText({
        type: 'item.completed',
        item: { type: 'agent_message', text: 'answer\n' },
    }), 'answer\n');
    assert.equal(eventLogText({
        type: 'item.completed',
        item: { type: 'reasoning', text: 'private reasoning' },
    }), '');
});

test('Codex runs only through providerRuntime.spawnWith and preserves streamed results', async () => {
    const runtime = providerRuntime();
    const visible = [];
    const result = await executeCodexTask({
        prompt: 'Build this.',
        projectDir: '/workspace/projects/example',
        model: 'gpt-initial',
        providerRuntime: runtime,
        logStream: { write: (chunk) => visible.push(String(chunk)) },
    });

    assert.equal(result.ok, true);
    assert.equal(result.outputText, 'final answer');
    assert.equal(result.threadId, THREAD_ID);
    assert.equal(result.projectDir, '/workspace/projects/example');
    assert.equal(runtime.calls.length, 1);
    assert.equal(runtime.calls[0].adapter.name, 'spawnTaskSandbox');
    assert.deepEqual(runtime.calls[0].input, {
        workdir: '/workspace/projects/example',
        args: buildCodexArgs({ prompt: 'Build this.', model: 'gpt-initial' }),
    });
    assert.deepEqual(Object.keys(runtime.calls[0].lifecycle).sort(), ['observeProcess', 'stdio']);
    assert.deepEqual(runtime.calls[0].lifecycle.stdio, ['ignore', 'pipe', 'pipe']);
    assert.equal(typeof runtime.calls[0].lifecycle.observeProcess, 'function');
    assert.equal(visible.join(''), 'command output\nfinal answer\nprovider stderr\n');
});

test('missing providerRuntime fails closed before provider execution', async () => {
    const result = await executeCodexTask({
        prompt: 'Build this.',
        projectDir: '/workspace/projects/example',
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PLOINKY_PROVIDER_RUNTIME_REQUIRED');
    assert.match(result.error, /providerRuntime/);
});

test('workdir validation is delegated without path resolution or directory creation', async () => {
    for (const projectDir of ['/workspace', '../escape', '/workspace/link/project']) {
        const expected = new Error('canonical workdir rejection');
        expected.code = 'PLOINKY_WORKDIR_INVALID';
        const runtime = {
            calls: [],
            async spawnWith(_adapter, input) {
                this.calls.push(input);
                throw expected;
            },
        };
        const result = await executeCodexTask({ prompt: 'Task', projectDir, providerRuntime: runtime });
        assert.equal(result.ok, false);
        assert.equal(result.code, 'PLOINKY_WORKDIR_INVALID');
        assert.deepEqual(runtime.calls[0].workdir, projectDir);
    }
});

test('execute provider module persists only canonical launch workdir and private thread data', async () => {
    const records = new Map();
    const leaseState = { held: true };
    const store = {
        writeContinuationRecord(handle, record) {
            assert.equal(leaseState.held, true);
            records.set(handle, record);
        },
    };
    const runtime = providerRuntime({ launchWorkdir: 'projects/example', leaseState });
    const result = await executeTestables.executeProviderTaskWithStore({
        input: {
            prompt: 'Initial task',
            projectDir: '/workspace/projects/example',
            model: 'gpt-initial',
        },
    }, { providerRuntime: runtime }, store);

    assert.equal(result.ok, true);
    assert.equal(result.outputText, 'final answer');
    assert.equal(result.continuation.toolName, 'continue-task');
    assert.match(result.continuation.handle, /^[0-9a-f-]{36}$/iu);
    assert.deepEqual(records.get(result.continuation.handle), {
        threadId: THREAD_ID,
        projectDir: '/workspace/projects/example',
    });
    assert.equal(leaseState.held, false);
});

test('execute provider module requires its injected runtime capability', async () => {
    const result = await executeProviderTask({
        input: { prompt: 'Task', projectDir: '/workspace/projects/example' },
    }, {});
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PLOINKY_PROVIDER_RUNTIME_REQUIRED');
});

test('failed and cancelled Codex processes retain an observed thread continuation', async () => {
    for (const runtime of [
        providerRuntime({ code: 1 }),
        providerRuntime({ abortSignal: AbortSignal.abort() }),
    ]) {
        const records = new Map();
        const result = await executeTestables.executeProviderTaskWithStore({
            input: { prompt: 'Task', projectDir: '/workspace/projects/example' },
        }, { providerRuntime: runtime }, {
            writeContinuationRecord(handle, record) { records.set(handle, record); },
        });
        assert.equal(result.ok, false);
        assert.equal(result.continuation.toolName, 'continue-task');
        assert.equal(records.get(result.continuation.handle).threadId, THREAD_ID);
    }
});

test('Codex continuation persistence failure rejects completion before HOME lease release', async () => {
    const leaseState = { held: true };
    const runtime = providerRuntime({ leaseState });
    const result = await executeTestables.executeProviderTaskWithStore({
        input: { prompt: 'Task', projectDir: '/workspace/projects/example' },
    }, { providerRuntime: runtime }, {
        writeContinuationRecord() {
            assert.equal(leaseState.held, true);
            throw Object.assign(new Error('simulated continuation write failure'), {
                code: 'PLOINKY_PROVIDER_CONTINUATION_WRITE_FAILED',
            });
        },
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'PLOINKY_PROVIDER_CONTINUATION_WRITE_FAILED');
    assert.equal(result.continuation, undefined);
    assert.equal(leaseState.held, false);
});

test('continuation resolves under the operation HOME lease then revalidates under the task lease', async () => {
    const handle = '2a9a13fb-8442-45d3-b7a7-af5a2335049e';
    const order = [];
    const writes = [];
    const leaseState = { held: true };
    let selections = 0;
    const store = {
        readContinuationRecord() {
            throw new Error('legacy pre-lease continuation read must not run');
        },
        selectContinuationRecordFromHome(homePath, value) {
            order.push(`select:${++selections}`);
            assert.equal(homePath, '/home/agent');
            assert.equal(value, handle);
            return { handle, threadId: THREAD_ID, projectDir: '/workspace/projects/example' };
        },
        writeContinuationRecord(value, record) {
            assert.equal(leaseState.held, true);
            writes.push({ value, record });
        },
    };
    const runtime = continuationProviderRuntime({ order, leaseState });
    const result = await continueTestables.continueProviderTaskWithStore({
        input: { handle, prompt: 'Continue.' },
    }, { providerRuntime: runtime }, store);

    assert.equal(result.ok, true);
    assert.equal(result.continuation.handle, handle);
    assert.equal(runtime.calls[0].input.args.includes('--model'), false);
    assert.equal(runtime.calls[0].input.workdir, '/workspace/projects/example');
    assert.equal(typeof runtime.calls[0].lifecycle.validateAfterLease, 'function');
    assert.deepEqual(order, [
        'resolve:start',
        'select:1',
        'resolve:end',
        'transition',
        'spawn:start',
        'select:2',
        'spawn:validated',
    ]);
    assert.deepEqual(writes, [{
        value: handle,
        record: { threadId: THREAD_ID, projectDir: '/workspace/projects/example' },
    }]);
    assert.equal(leaseState.held, false);

    const invalid = await continueProviderTask({
        input: { handle, prompt: 'Continue.', model: 'legacy-override' },
    }, { providerRuntime: runtime });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.code, 'PLOINKY_PROVIDER_RUNTIME_INPUT_INVALID');
});

test('continuation rejects thread and project record races before the provider task is released', async () => {
    const handle = '2a9a13fb-8442-45d3-b7a7-af5a2335049e';
    for (const changed of [
        { threadId: 'different-thread' },
        { projectDir: '/workspace/projects/sibling' },
    ]) {
        const writes = [];
        let selections = 0;
        const runtime = continuationProviderRuntime();
        const result = await continueTestables.continueProviderTaskWithStore({
            input: { handle, prompt: 'Continue.' },
        }, { providerRuntime: runtime }, {
            selectContinuationRecordFromHome() {
                selections += 1;
                return {
                    handle,
                    threadId: THREAD_ID,
                    projectDir: '/workspace/projects/example',
                    ...(selections === 2 ? changed : {}),
                };
            },
            writeContinuationRecord(...args) { writes.push(args); },
        });

        assert.equal(result.ok, false);
        assert.equal(result.code, 'PLOINKY_PROVIDER_CONTINUATION_CHANGED');
        assert.match(result.error, /state changed/u);
        assert.equal(selections, 2);
        assert.equal(runtime.calls.length, 0);
        assert.deepEqual(writes, []);
    }
});

test('continuation rejects task HOME, runtime, and workdir identity drift before execution', async () => {
    const handle = '2a9a13fb-8442-45d3-b7a7-af5a2335049e';
    for (const validationOverrides of [
        { homePath: '/root' },
        { runtimeKind: 'container' },
        { workdir: 'projects/sibling' },
    ]) {
        let selections = 0;
        const runtime = continuationProviderRuntime({ validationOverrides });
        const result = await continueTestables.continueProviderTaskWithStore({
            input: { handle, prompt: 'Continue.' },
        }, { providerRuntime: runtime }, {
            selectContinuationRecordFromHome() {
                selections += 1;
                return { handle, threadId: THREAD_ID, projectDir: '/workspace/projects/example' };
            },
            writeContinuationRecord() {
                assert.fail('identity rejection must not update continuation state');
            },
        });
        assert.equal(result.ok, false);
        assert.equal(result.code, 'PLOINKY_PROVIDER_CONTINUATION_CHANGED');
        assert.equal(selections, 1);
        assert.equal(runtime.calls.length, 0);
    }
});

test('continuation fails closed when HOME resolution or task transition fails', async () => {
    const handle = '2a9a13fb-8442-45d3-b7a7-af5a2335049e';
    const resolverError = Object.assign(new Error('resolver lease failed'), {
        code: 'PLOINKY_PROVIDER_HOME_BUSY',
    });
    const transitionError = Object.assign(new Error('transition rejected'), {
        code: 'PLOINKY_PROVIDER_RUNTIME_TRANSITION_INVALID',
    });
    for (const options of [{ resolverError }, { transitionError }]) {
        let selections = 0;
        const runtime = continuationProviderRuntime(options);
        const result = await continueTestables.continueProviderTaskWithStore({
            input: { handle, prompt: 'Continue.' },
        }, { providerRuntime: runtime }, {
            selectContinuationRecordFromHome() {
                selections += 1;
                return { handle, threadId: THREAD_ID, projectDir: '/workspace/projects/example' };
            },
            writeContinuationRecord() {
                assert.fail('failed continuation admission must not update state');
            },
        });
        assert.equal(result.ok, false);
        assert.equal(result.code, options.resolverError
            ? 'PLOINKY_PROVIDER_HOME_BUSY'
            : 'PLOINKY_PROVIDER_RUNTIME_TRANSITION_INVALID');
        assert.equal(runtime.calls.length, 0);
        assert.equal(selections, options.resolverError ? 0 : 1);
    }
});

test('continuation fails closed when post-lease state cannot be reread', async () => {
    const handle = '2a9a13fb-8442-45d3-b7a7-af5a2335049e';
    let selections = 0;
    const runtime = continuationProviderRuntime();
    const result = await continueTestables.continueProviderTaskWithStore({
        input: { handle, prompt: 'Continue.' },
    }, { providerRuntime: runtime }, {
        selectContinuationRecordFromHome() {
            selections += 1;
            if (selections === 2) throw new Error('record disappeared');
            return { handle, threadId: THREAD_ID, projectDir: '/workspace/projects/example' };
        },
        writeContinuationRecord() {
            assert.fail('post-lease read failure must not update state');
        },
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'PLOINKY_PROVIDER_CONTINUATION_CHANGED');
    assert.match(result.error, /could not be revalidated/u);
    assert.equal(runtime.calls.length, 0);
});

test('continuation uses the selected container HOME without cross-mode state lookup', async () => {
    const handle = '2a9a13fb-8442-45d3-b7a7-af5a2335049e';
    const homes = [];
    const runtime = continuationProviderRuntime({ homePath: '/root', runtimeKind: 'container' });
    const result = await continueTestables.continueProviderTaskWithStore({
        input: { handle, prompt: 'Continue.' },
    }, { providerRuntime: runtime }, {
        selectContinuationRecordFromHome(homePath) {
            homes.push(homePath);
            return { handle, threadId: THREAD_ID, projectDir: '/workspace/projects/example' };
        },
        writeContinuationRecord() {},
    });

    assert.equal(result.ok, true);
    assert.deepEqual(homes, ['/root', '/root']);
});

test('Codex task modules have no executable child-process fallback', async () => {
    for (const relative of [
        '../scripts/codex-runner.mjs',
        '../scripts/execute-task.mjs',
        '../scripts/continue-task.mjs',
    ]) {
        const source = await fs.readFile(new URL(relative, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /node:child_process|\bspawn\s*\(/u);
    }
});

test('Codex continuation has no legacy reader, environment lookup, or custom executable resolver', async () => {
    const source = await fs.readFile(new URL('../scripts/continue-task.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(
        source,
        /readContinuationRecord\b|process\.env|resolveCodexBinary|CODEX_BIN|argv0/u,
    );
    assert.match(source, /resolveHomeState/u);
    assert.match(source, /transitionToTask/u);
    assert.match(source, /validateAfterLease/u);
});

test('Codex manifest admits canonical readiness and provider module execution', async () => {
    const agentRoot = path.resolve(new URL('..', import.meta.url).pathname);
    const manifest = JSON.parse(await fs.readFile(path.join(agentRoot, 'manifest.json'), 'utf8'));
    const config = JSON.parse(await fs.readFile(path.join(agentRoot, 'mcp-config.json'), 'utf8'));
    assert.deepEqual(config.providerSandbox, { provider: 'codex', readiness: true });
    for (const name of ['execute-task', 'continue-task']) {
        const tool = config.tools.find((entry) => entry.name === name);
        assert.deepEqual(tool.providerExecution, {
            provider: 'codex',
            mode: name === 'execute-task' ? 'task' : 'operation',
            module: `/code/scripts/${name}.mjs`,
            export: name === 'execute-task' ? 'executeProviderTask' : 'continueProviderTask',
        });
        assert.equal(tool.command, undefined);
        assert.equal(tool.async, true);
    }
    assert.equal(manifest.container, 'docker.io/assistos/ploinky-node:24-bookworm-tools');
    assert.equal(manifest['lite-sandbox'], true);
});
