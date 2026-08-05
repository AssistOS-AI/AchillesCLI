import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { __testables as continuationTestables } from '../scripts/continuation-store.mjs';
import {
    createContinuationHandle,
} from '../scripts/continuation-store.mjs';
import {
    __testables as executeTaskTestables,
    executeProviderTask,
} from '../scripts/execute-task.mjs';
import { __testables as continueTaskTestables } from '../scripts/continue-task.mjs';
import { spawnTaskSandbox } from '../scripts/task-sandbox.mjs';
import { createContinuationStoreFixture } from './continuation-store-fixture.mjs';

async function createSessionDatabase(dataRoot) {
    const directory = path.join(dataRoot, 'opencode');
    await fs.mkdir(directory, { recursive: true });
    const { DatabaseSync } = await import('node:sqlite');
    const database = new DatabaseSync(path.join(directory, 'opencode.db'));
    database.exec(`
        CREATE TABLE session (
            id TEXT PRIMARY KEY,
            directory TEXT NOT NULL,
            title TEXT NOT NULL,
            time_updated INTEGER NOT NULL
        )
    `);
    database.close();
}

function insertSession(dataRoot, { directory, title, sessionId = 'ses_provider_task' }) {
    const databasePath = path.join(dataRoot, 'opencode', 'opencode.db');
    return import('node:sqlite').then(({ DatabaseSync }) => {
        const database = new DatabaseSync(databasePath);
        try {
            database.prepare(
                'INSERT INTO session (id, directory, title, time_updated) VALUES (?, ?, ?, ?)',
            ).run(sessionId, directory, title, Date.now());
        } finally {
            database.close();
        }
    });
}

function fakeProviderRuntime({
    dataRoot,
    continuationRoot,
    code = 0,
    closeSignal = null,
    completeBeforeReturn = false,
} = {}) {
    const calls = [];
    const runtime = {
        calls,
        leaseHeld: false,
        recordObservedWhileLeaseHeld: false,
        provider: 'opencode',
        mode: 'task',
        async spawnWith(adapter, input, lifecycle) {
            assert.equal(adapter, spawnTaskSandbox);
            const workdir = input.workdir.startsWith('/workspace/')
                ? input.workdir.slice('/workspace/'.length)
                : input.workdir;
            const cwd = `/workspace/${workdir}`;
            const titleIndex = input.args.indexOf('--title');
            assert.ok(titleIndex > 0);
            await insertSession(dataRoot, {
                directory: cwd,
                title: input.args[titleIndex + 1],
            });
            const child = new EventEmitter();
            child.stdout = new PassThrough();
            child.stderr = new PassThrough();
            const launch = Object.freeze({
                helper: '/usr/local/libexec/ploinky-bwrap-launch',
                provider: 'opencode',
                mode: 'task',
                workdir: input.workdir,
                cwd,
            });
            const call = { adapter, input, lifecycle, child, afterExitInput: null };
            calls.push(call);
            runtime.leaseHeld = true;
            const finish = async () => {
                child.stdout.end('provider output');
                child.stderr.end('provider diagnostic');
                const afterExitInput = Object.freeze({ code, signal: closeSignal, launch });
                call.afterExitInput = afterExitInput;
                assert.equal(runtime.leaseHeld, true);
                const afterExit = await lifecycle.afterExit(afterExitInput);
                runtime.recordObservedWhileLeaseHeld = (await fs.readdir(continuationRoot))
                    .some((name) => name.endsWith('.json'));
                await fs.rename(
                    path.join(dataRoot, 'opencode', 'opencode.db'),
                    path.join(dataRoot, 'opencode', 'opencode.db.after-exit'),
                );
                runtime.leaseHeld = false;
                return { code, signal: closeSignal, afterExit };
            };
            const completion = completeBeforeReturn
                ? Promise.resolve(await finish())
                : new Promise((resolve, reject) => {
                    setImmediate(() => finish().then(resolve, reject));
                });
            return {
                child,
                launch,
                completion,
            };
        },
    };
    return runtime;
}

async function withTaskState(mock, run) {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-provider-task-'));
    const dataRoot = path.join(temporary, 'data');
    const homeRoot = path.join(temporary, 'home');
    const continuationRoot = path.join(homeRoot, '.ploinky', 'task-sessions');
    await fs.mkdir(homeRoot);
    await createSessionDatabase(dataRoot);
    const continuationStore = createContinuationStoreFixture({
        homeRoot,
        storeRoot: continuationRoot,
    });
    const previousDataRoot = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = dataRoot;
    try {
        return await run({ continuationRoot, continuationStore, dataRoot, homeRoot });
    } finally {
        if (previousDataRoot === undefined) delete process.env.XDG_DATA_HOME;
        else process.env.XDG_DATA_HOME = previousDataRoot;
    }
}

test('executeProviderTask uses exactly one admitted OpenCode provider boundary', { concurrency: false }, async (t) => {
    await withTaskState(t.mock, async ({ continuationRoot, continuationStore, dataRoot }) => {
        const providerRuntime = fakeProviderRuntime({ dataRoot, continuationRoot });
        const result = await executeTaskTestables.executeProviderTaskWithStore({
            tool: 'execute-task',
            taskId: 'task-1',
            input: {
                prompt: 'Implement the change.',
                projectDir: '/workspace/projects/alpha',
                model: 'xai/grok-4.3',
            },
        }, { providerRuntime, signal: new AbortController().signal }, continuationStore);

        assert.equal(result.ok, true);
        assert.equal(result.outputText, 'provider output');
        assert.equal(result.continuation.toolName, 'continue-task');
        assert.equal(providerRuntime.calls.length, 1);
        assert.equal(providerRuntime.recordObservedWhileLeaseHeld, true);
        assert.equal(providerRuntime.leaseHeld, false);
        const [{ input, lifecycle, afterExitInput }] = providerRuntime.calls;
        assert.deepEqual(Object.keys(input).sort(), ['args', 'workdir']);
        assert.equal(input.workdir, '/workspace/projects/alpha');
        assert.deepEqual(input.args.slice(0, 2), ['run', '--auto']);
        assert.equal(input.args[input.args.indexOf('--model') + 1], 'soul/fast');
        assert.equal(input.args.at(-1), 'Implement the change.');
        assert.equal(input.args.includes('--dir'), false);
        assert.deepEqual(lifecycle.stdio, ['ignore', 'pipe', 'pipe']);
        assert.equal(typeof lifecycle.afterExit, 'function');
        assert.equal('PLOINKY_TASK_BROKER_URL' in lifecycle.environment, false);
        assert.equal('PLOINKY_TASK_BROKER_KEY' in lifecycle.environment, false);
        assert.equal('credentialContext' in input, false);
        assert.deepEqual(Object.keys(afterExitInput.launch).sort(), [
            'cwd',
            'helper',
            'mode',
            'provider',
            'workdir',
        ]);
        assert.equal('env' in afterExitInput.launch, false);
        assert.equal('environment' in afterExitInput.launch, false);
        assert.equal('broker' in afterExitInput.launch, false);
        assert.equal('credentialContext' in afterExitInput.launch, false);

        const record = JSON.parse(await fs.readFile(
            path.join(continuationRoot, `${result.continuation.handle}.json`),
            'utf8',
        ));
        assert.equal(record.sessionId, 'ses_provider_task');
        assert.equal(record.projectDir, '/workspace/projects/alpha');
    });
});

test('continuation store rejects a symlinked intermediate without escaping HOME', { concurrency: false }, async (t) => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-continuation-symlink-'));
    const homeRoot = path.join(temporary, 'home');
    const outside = path.join(temporary, 'outside-workspace-sibling');
    await fs.mkdir(homeRoot);
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(homeRoot, '.ploinky'));
    const continuationStore = createContinuationStoreFixture({
        homeRoot,
        storeRoot: path.join(homeRoot, '.ploinky', 'task-sessions'),
    });

    assert.throws(() => continuationStore.writeContinuationRecord(createContinuationHandle(), {
        projectDir: '/workspace/projects/alpha',
        sessionId: 'ses_escape_attempt',
    }), /unsafe_continuation_store/);
    await assert.rejects(fs.access(path.join(outside, 'task-sessions')));
});

test('production continuation store is Linux retained-fd-only', {
    skip: process.platform === 'linux' ? 'non-Linux fail-closed contract' : false,
}, () => {
    assert.throws(
        () => continuationTestables.createRetainedFilesystem('/home/agent')
            .readFile('/home/agent/.ploinky/task-sessions', `${createContinuationHandle()}.json`, {
                create: false,
                errorCode: 'unsafe_continuation_record',
                purpose: 'continuation-record-read',
            }),
        (error) => error?.code === 'PLOINKY_RETAINED_FD_UNAVAILABLE',
    );
});

test('Linux retained install rejects substituted temp inode and fsyncs the store directory', {
    skip: process.platform !== 'linux' ? 'requires Linux retained directory descriptors' : false,
    concurrency: false,
}, async (t) => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-retained-install-'));
    t.after(() => fs.rm(temporary, { recursive: true, force: true }));
    const homeRoot = path.join(temporary, 'home');
    const storeRoot = path.join(homeRoot, '.ploinky', 'task-sessions');
    await fs.mkdir(homeRoot);
    const originalFsync = fsSync.fsyncSync.bind(fsSync);
    let directoryFsyncs = 0;
    t.mock.method(fsSync, 'fsyncSync', (fd) => {
        if (fsSync.fstatSync(fd).isDirectory()) directoryFsyncs += 1;
        return originalFsync(fd);
    });
    const safeStore = continuationTestables.createContinuationStore(
        { homeRoot, storeRoot },
        continuationTestables.createRetainedFilesystem(homeRoot),
    );
    safeStore.writeContinuationRecord(createContinuationHandle(), {
        sessionId: 'ses_durable',
        projectDir: '/workspace/projects/durable',
    });
    assert.equal(directoryFsyncs, 1);

    const attackerRecord = `${JSON.stringify({
        version: 1,
        provider: 'opencode',
        sessionId: 'ses_attacker',
        projectDir: '/workspace/attacker',
    })}\n`;
    const attackerPath = path.join(temporary, 'attacker-record.json');
    fsSync.writeFileSync(attackerPath, attackerRecord, { mode: 0o600 });
    const attackedHandle = createContinuationHandle();
    const attackedStore = continuationTestables.createContinuationStore(
        { homeRoot, storeRoot },
        continuationTestables.createRetainedFilesystem(homeRoot, {
            beforeRename({ temporaryPath }) {
                fsSync.unlinkSync(temporaryPath);
                fsSync.linkSync(attackerPath, temporaryPath);
            },
        }),
    );
    assert.throws(() => attackedStore.writeContinuationRecord(attackedHandle, {
        sessionId: 'ses_expected',
        projectDir: '/workspace/projects/expected',
    }), /unsafe_continuation_store/);
    assert.equal(fsSync.readFileSync(attackerPath, 'utf8'), attackerRecord);
    assert.equal(fsSync.existsSync(path.join(storeRoot, `${attackedHandle}.json`)), false);
    assert.throws(() => attackedStore.readContinuationRecord(attackedHandle));

    const symlinkHandle = createContinuationHandle();
    const symlinkStore = continuationTestables.createContinuationStore(
        { homeRoot, storeRoot },
        continuationTestables.createRetainedFilesystem(homeRoot, {
            beforeRename({ temporaryPath }) {
                fsSync.unlinkSync(temporaryPath);
                fsSync.symlinkSync(attackerPath, temporaryPath);
            },
        }),
    );
    assert.throws(() => symlinkStore.writeContinuationRecord(symlinkHandle, {
        sessionId: 'ses_expected',
        projectDir: '/workspace/projects/expected',
    }), /unsafe_continuation_store/);
    assert.equal(fsSync.readFileSync(attackerPath, 'utf8'), attackerRecord);
    assert.equal(fsSync.existsSync(path.join(storeRoot, `${symlinkHandle}.json`)), false);
});

test('continuation records reject ambient, root, and non-canonical project paths', () => {
    for (const projectDir of [
        'projects/alpha',
        '/workspace',
        '/workspace/projects/../sibling',
        '/tmp/alpha',
    ]) {
        assert.throws(() => continuationTestables.assertProjectDir(projectDir), {
            message: 'invalid_continuation_record',
        });
    }
    assert.equal(
        continuationTestables.assertProjectDir('/workspace/projects/alpha'),
        '/workspace/projects/alpha',
    );
});

test('instant failed OpenCode exit persists its continuation before HOME lease release', { concurrency: false }, async (t) => {
    await withTaskState(t.mock, async ({ continuationRoot, continuationStore, dataRoot }) => {
        const providerRuntime = fakeProviderRuntime({
            dataRoot,
            continuationRoot,
            code: 23,
            completeBeforeReturn: true,
        });
        const result = await executeTaskTestables.executeProviderTaskWithStore({
            input: {
                prompt: 'Try the unavailable operation.',
                projectDir: 'projects/failure',
            },
        }, { providerRuntime }, continuationStore);

        assert.equal(result.ok, false);
        assert.match(result.error, /exit code 23/);
        assert.equal(result.continuation.toolName, 'continue-task');
        assert.equal(providerRuntime.calls.length, 1);
        assert.equal(providerRuntime.recordObservedWhileLeaseHeld, true);
        assert.equal(providerRuntime.leaseHeld, false);
        const record = JSON.parse(await fs.readFile(
            path.join(continuationRoot, `${result.continuation.handle}.json`),
            'utf8',
        ));
        assert.equal(record.sessionId, 'ses_provider_task');
        assert.equal(record.projectDir, '/workspace/projects/failure');
    });
});

test('executeProviderTask fails closed without input or admitted runtime', async () => {
    const notCalled = { provider: 'opencode', spawnWith() { throw new Error('must not spawn'); } };
    assert.deepEqual(await executeProviderTask({ input: {} }, { providerRuntime: notCalled }), {
        ok: false,
        outputText: '',
        error: 'prompt is required and must be a non-empty string.',
        code: 'PLOINKY_PROVIDER_RUNTIME_INPUT_INVALID',
    });
    const result = await executeProviderTask({
        input: { prompt: 'Do not fall back.', projectDir: 'projects/no-runtime' },
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PLOINKY_PROVIDER_RUNTIME_REQUIRED');
    assert.match(result.error, /admitted provider runtime/);
});

test('continue-task resolves HOME state once, transitions, and revalidates before provider execution', async () => {
    const handle = '11111111-1111-4111-8111-111111111111';
    const record = Object.freeze({
        version: 1,
        provider: 'opencode',
        sessionId: 'ses-continued',
        projectDir: '/workspace/projects/alpha',
        createdAt: '2026-08-05T00:00:00.000Z',
        updatedAt: '2026-08-05T00:01:00.000Z',
    });
    const order = [];
    const runtime = {
        provider: 'opencode',
        mode: 'operation',
        spawnWith() {},
        async resolveHomeState(resolver) {
            order.push('resolve');
            return resolver({
                homePath: '/home/agent',
                provider: 'opencode',
                runtimeKind: 'bwrap',
            });
        },
        transitionToTask() {
            order.push('transition');
            this.mode = 'task';
        },
    };
    let reads = 0;
    const result = await continueTaskTestables.continueProviderTaskWithDependencies({
        input: { handle, prompt: 'Continue exactly.' },
    }, { providerRuntime: runtime }, {
        continuationStoreForHome(homePath) {
            assert.equal(homePath, '/home/agent');
            return {
                readContinuationRecord(requestedHandle) {
                    reads += 1;
                    assert.equal(requestedHandle, handle);
                    return { ...record };
                },
            };
        },
        async readRecentOpenCodeModel(env) {
            order.push('model');
            assert.deepEqual(env, { HOME: '/home/agent' });
            return { model: 'soul/plan', variant: 'high' };
        },
        async executeOpenCodeTask(input) {
            order.push('preexec-revalidation');
            assert.equal(runtime.mode, 'task');
            assert.equal(input.projectDir, record.projectDir);
            assert.equal(input.sessionId, record.sessionId);
            assert.equal(input.model, 'soul/plan');
            assert.equal(input.variant, 'high');
            input.validateAfterLease({
                homePath: '/home/agent',
                provider: 'opencode',
                runtimeKind: 'bwrap',
                mode: 'task',
                workdir: 'projects/alpha',
            });
            order.push('provider');
            return { ok: true, outputText: 'continued output' };
        },
    });

    assert.deepEqual(result, {
        ok: true,
        outputText: 'continued output',
        continuation: { version: 1, handle, toolName: 'continue-task' },
    });
    assert.equal(reads, 2);
    assert.deepEqual(order, [
        'resolve',
        'model',
        'transition',
        'preexec-revalidation',
        'provider',
    ]);
});

test('continue-task rejects a changed record in the post-lease preexec hook', async () => {
    const handle = '22222222-2222-4222-8222-222222222222';
    const record = {
        version: 1,
        provider: 'opencode',
        sessionId: 'ses-original',
        projectDir: '/workspace/projects/alpha',
        createdAt: '2026-08-05T00:00:00.000Z',
        updatedAt: '2026-08-05T00:01:00.000Z',
    };
    let reads = 0;
    let providerStarted = false;
    const runtime = {
        provider: 'opencode',
        mode: 'operation',
        spawnWith() {},
        resolveHomeState: (resolver) => resolver({
            homePath: '/root',
            provider: 'opencode',
            runtimeKind: 'container',
        }),
        transitionToTask() { this.mode = 'task'; },
    };

    await assert.rejects(
        continueTaskTestables.continueProviderTaskWithDependencies({
            input: { handle, prompt: 'Must not start.' },
        }, { providerRuntime: runtime }, {
            continuationStoreForHome() {
                return {
                    readContinuationRecord() {
                        reads += 1;
                        return reads === 1
                            ? { ...record }
                            : { ...record, sessionId: 'ses-substituted' };
                    },
                };
            },
            readRecentOpenCodeModel: async () => ({ model: '', variant: '' }),
            async executeOpenCodeTask(input) {
                input.validateAfterLease({
                    homePath: '/root',
                    provider: 'opencode',
                    runtimeKind: 'container',
                    mode: 'task',
                    workdir: 'projects/alpha',
                });
                providerStarted = true;
                return { ok: true };
            },
        }),
        (error) => error?.code === 'PLOINKY_CONTINUATION_STATE_CHANGED',
    );
    assert.equal(providerStarted, false);
    assert.equal(reads, 2);
});

test('OpenCode execute-task config and source have no shell or broker fallback', async () => {
    const config = JSON.parse(await fs.readFile(
        new URL('../mcp-config.json', import.meta.url),
        'utf8',
    ));
    assert.deepEqual(config.providerSandbox, { provider: 'opencode', readiness: true });
    const executeTask = config.tools.find(({ name }) => name === 'execute-task');
    assert.deepEqual(executeTask.providerExecution, {
        provider: 'opencode',
        mode: 'task',
        module: '/code/scripts/execute-task.mjs',
        export: 'executeProviderTask',
    });
    assert.equal(executeTask.async, true);
    for (const field of ['command', 'args', 'cwd', 'env']) {
        assert.equal(field in executeTask, false, field);
    }
    const continuation = config.tools.find(({ name }) => name === 'continue-task');
    assert.deepEqual(continuation.providerExecution, {
        provider: 'opencode',
        mode: 'operation',
        module: '/code/scripts/continue-task.mjs',
        export: 'continueProviderTask',
    });
    const control = config.tools.find(({ name }) => name === 'task-session-control');
    assert.deepEqual(control.providerExecution, {
        provider: 'opencode',
        mode: 'operation',
        module: '/code/scripts/task-session-control.mjs',
        export: 'executeTaskSessionControl',
    });

    const taskSource = await fs.readFile(
        new URL('../scripts/execute-task.mjs', import.meta.url),
        'utf8',
    );
    const runnerSource = await fs.readFile(
        new URL('../scripts/opencode-runner.mjs', import.meta.url),
        'utf8',
    );
    const continuationSource = await fs.readFile(
        new URL('../scripts/continuation-store.mjs', import.meta.url),
        'utf8',
    );
    const runtimeStore = continuationTestables.continuationStoreForEnvironment({
        HOME: '/home/agent',
    }, {
        atomicWrite() {},
        readFile() { return '{}'; },
    });
    assert.equal(typeof runtimeStore.readContinuationRecord, 'function');
    assert.match(runnerSource, /providerRuntime\.spawnWith\(\s*spawnTaskSandbox,/);
    assert.doesNotMatch(taskSource, /\.writeContinuationRecord\(/);
    assert.match(runnerSource, /afterExit:[\s\S]*continuationStore\.writeContinuationRecord\(/);
    for (const forbidden of [
        "node:child_process",
        'startScopedSoulBroker',
        'buildTaskSandboxLaunch',
        'prepareTaskSandbox',
        'createProjectDir',
        'PLOINKY_TASK_BROKER_',
        'credentialContext',
        'OPENCODE_BIN',
        '/root',
        '/usr/bin/bwrap',
    ]) {
        assert.equal(runnerSource.includes(forbidden), false, forbidden);
        assert.equal(taskSource.includes(forbidden), false, forbidden);
    }
    assert.equal(continuationSource.includes('/root'), false);
    assert.match(continuationSource, /runtimeHome\(env = process\.env\)/);
    assert.doesNotMatch(continuationSource, /HOME\s*\|\||['"]\/root['"]/);
    assert.equal(continuationSource.includes('PLOINKY_CONTINUATION_STORE_DIR'), false);
    assert.equal(continuationSource.includes('openPortableStore'), false);
    assert.equal(executeTask.inputSchema.projectDir.description.includes('symlink'), false);
    assert.equal(taskSource.includes('process.stdin'), false);
    assert.equal(taskSource.includes('main('), false);
});
