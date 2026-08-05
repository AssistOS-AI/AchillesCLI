import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import test from 'node:test';

import { spawnTaskSandbox } from '../scripts/task-sandbox.mjs';
import {
    __testables as interactiveTestables,
    runInteractiveMain,
} from '../scripts/interactive-cli.mjs';

function fixture() {
    const calls = [];
    const credentialContext = Object.freeze({ fixture: 'trusted-context' });
    const brokerRegistry = Object.freeze({
        async close() { calls.push({ type: 'broker-close' }); },
    });
    const runtime = {
        provider: 'opencode',
        mode: 'task',
        async spawnWith(adapter, input, lifecycle) {
            calls.push({ type: 'spawn', adapter, input, lifecycle });
            return { completion: Promise.resolve({ code: 0, signal: null }) };
        },
        assertBoundaryUsed() { calls.push({ type: 'boundary' }); },
        async close() { calls.push({ type: 'runtime-close' }); },
    };
    const dependencies = {
        bootstrapAgentCredentialContext(env) {
            calls.push({ type: 'credential-bootstrap', env });
            return credentialContext;
        },
        async startScopedSoulBrokerRegistry(input) {
            calls.push({ type: 'broker-start', input });
            return brokerRegistry;
        },
        createProviderTaskRuntime(input) {
            calls.push({ type: 'runtime-create', input });
            return runtime;
        },
        randomUUID() { return '11111111-1111-4111-8111-111111111111'; },
        spawnTaskSandbox,
    };
    return { calls, dependencies, credentialContext, brokerRegistry, runtime };
}

test('interactive CLI uses one trusted bootstrap and the canonical task boundary with inherited PTY', async () => {
    const { calls, dependencies, credentialContext, brokerRegistry } = fixture();
    const { runInteractiveCli } = await import('../scripts/interactive-cli.mjs');
    const signal = new AbortController().signal;
    const env = { PLOINKY_RUNTIME: 'bwrap', TERM: 'xterm-256color', HOME: '/home/agent' };
    const result = await runInteractiveCli(
        ['--workdir', 'projects/alpha', '--', '--model', 'soul/plan', 'prompt with spaces'],
        env,
        { ...dependencies, signal },
    );

    assert.deepEqual(result, { code: 0, signal: null });
    assert.deepEqual(calls[0], { type: 'credential-bootstrap', env });
    assert.deepEqual(calls[1], { type: 'broker-start', input: { credentialContext } });
    assert.deepEqual(calls[2], {
        type: 'runtime-create',
        input: {
            credentialContext,
            brokerRegistry,
            mode: 'task',
            provider: 'opencode',
            taskId: 'interactive-11111111-1111-4111-8111-111111111111',
            audience: 'interactive:opencode',
            signal,
        },
    });
    assert.equal(calls[3].type, 'spawn');
    assert.equal(calls[3].adapter, spawnTaskSandbox);
    assert.deepEqual(calls[3].input, {
        workdir: 'projects/alpha',
        args: ['--model', 'soul/plan', 'prompt with spaces'],
    });
    assert.deepEqual(calls[3].lifecycle, {
        environment: { TERM: 'xterm-256color' },
        leaseMetadata: { purpose: 'opencode-interactive' },
        stdio: ['inherit', 'inherit', 'inherit'],
    });
    assert.deepEqual(calls.slice(-3).map(({ type }) => type), [
        'boundary',
        'runtime-close',
        'broker-close',
    ]);
});

test('interactive CLI delegates both admitted selector modes only through trusted bootstrap', async () => {
    const { runInteractiveCli } = await import('../scripts/interactive-cli.mjs');
    for (const runtime of ['bwrap', 'container']) {
        const current = fixture();
        const env = { PLOINKY_RUNTIME: runtime, exactDescriptor: `${runtime}-fixture` };
        await runInteractiveCli(['--workdir', '/workspace/projects/a', '--'], env, current.dependencies);
        assert.deepEqual(current.calls[0], { type: 'credential-bootstrap', env });
        assert.equal(current.calls.filter(({ type }) => type === 'credential-bootstrap').length, 1);
    }
});

test('interactive CLI rejects invalid and legacy workdir grammar before credential or broker work', async () => {
    const { calls, dependencies } = fixture();
    const { runInteractiveCli } = await import('../scripts/interactive-cli.mjs');
    for (const argv of [
        [],
        ['projects/a'],
        ['--workdir', 'projects/a'],
        ['--workdir', '', '--'],
        ['--workdir', 'projects/a', 'run'],
        ['--workdir', 'projects/../a', '--'],
        ['--workdir', '/tmp/project', '--'],
        ['--workdir', '.data/agent', '--'],
        ['--workdir', '.ploinky/run', '--'],
    ]) {
        await assert.rejects(
            runInteractiveCli(argv, { PLOINKY_RUNTIME: 'bwrap' }, dependencies),
            (error) => error?.code === 'PLOINKY_PROVIDER_RUNTIME_INPUT_INVALID'
                || error?.code === 'PLOINKY_WORKDIR_INVALID',
        );
    }
    await assert.rejects(
        runInteractiveCli(['--workdir', '/workspace', '--'], {}, dependencies),
        (error) => error?.code === 'PLOINKY_WORKDIR_ROOT_FORBIDDEN',
    );
    assert.equal(calls.length, 0);
});

test('interactive CLI closes the broker even when runtime cleanup fails', async () => {
    const { dependencies, runtime } = fixture();
    let brokerClosed = false;
    dependencies.startScopedSoulBrokerRegistry = async () => ({
        async close() { brokerClosed = true; },
    });
    runtime.close = async () => { throw new Error('runtime-close-failed'); };

    await assert.rejects(
        runWithDependencies(dependencies),
        /runtime-close-failed/,
    );
    assert.equal(brokerClosed, true);
});

test('interactive CLI preserves provider exit and signal semantics', () => {
    assert.equal(interactiveTestables.exitCodeForCompletion({ code: 23, signal: null }), 23);
    assert.equal(interactiveTestables.exitCodeForCompletion({ code: null, signal: 'SIGINT' }), 130);
    assert.equal(interactiveTestables.exitCodeForCompletion({ code: null, signal: 'SIGTERM' }), 143);
    assert.equal(interactiveTestables.exitCodeForCompletion({ code: null, signal: 'SIGKILL' }), 1);
});

test('SIGINT during broker bootstrap exits 130 without creating or spawning a provider runtime', async () => {
    const { calls, dependencies, brokerRegistry } = fixture();
    let releaseBroker;
    let brokerStarted;
    const brokerStart = new Promise((resolve) => { brokerStarted = resolve; });
    const brokerRelease = new Promise((resolve) => { releaseBroker = resolve; });
    dependencies.startScopedSoulBrokerRegistry = async (input) => {
        calls.push({ type: 'broker-start', input });
        brokerStarted();
        await brokerRelease;
        return brokerRegistry;
    };

    const runtimeProcess = new EventEmitter();
    runtimeProcess.argv = [
        process.execPath,
        '/code/scripts/interactive-cli.mjs',
        '--workdir',
        'projects/a',
        '--',
    ];
    runtimeProcess.env = { PLOINKY_RUNTIME: 'bwrap' };
    runtimeProcess.exitCode = undefined;

    const execution = runInteractiveMain(runtimeProcess, async () => dependencies);
    await brokerStart;
    assert.equal(runtimeProcess.listenerCount('SIGINT'), 1);
    runtimeProcess.emit('SIGINT');
    releaseBroker();
    await execution;

    assert.equal(runtimeProcess.exitCode, 130);
    assert.deepEqual(calls.map(({ type }) => type), [
        'credential-bootstrap',
        'broker-start',
        'broker-close',
    ]);
    assert.equal(calls.some(({ type }) => type === 'runtime-create' || type === 'spawn'), false);
    for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        assert.equal(runtimeProcess.listenerCount(name), 0);
    }
});

test('OpenCode SIGINT retains exit 130 when cancelled broker cleanup fails', async () => {
    const { calls, dependencies } = fixture();
    let releaseBroker;
    let brokerStarted;
    const started = new Promise((resolve) => { brokerStarted = resolve; });
    const release = new Promise((resolve) => { releaseBroker = resolve; });
    dependencies.startScopedSoulBrokerRegistry = async () => {
        calls.push({ type: 'broker-start' });
        brokerStarted();
        await release;
        return Object.freeze({ async close() { throw new Error('broker close failed'); } });
    };
    const runtimeProcess = Object.assign(new EventEmitter(), {
        argv: [process.execPath, '/code/scripts/interactive-cli.mjs', '--workdir', 'projects/a', '--'],
        env: {}, exitCode: undefined,
    });
    const pending = runInteractiveMain(runtimeProcess, async () => dependencies);
    await started;
    runtimeProcess.emit('SIGINT');
    releaseBroker();
    await pending;
    assert.equal(runtimeProcess.exitCode, 130);
    assert.equal(calls.some(({ type }) => type === 'runtime-create' || type === 'spawn'), false);
});

async function runWithDependencies(dependencies) {
    const { runInteractiveCli } = await import('../scripts/interactive-cli.mjs');
    return runInteractiveCli(
        ['--workdir', 'projects/a', '--'],
        { PLOINKY_RUNTIME: 'bwrap' },
        dependencies,
    );
}

test('manifest CLI is the canonical adapter and contains no raw provider or credential reconstruction', async () => {
    const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
    assert.equal(manifest.cli, 'node /code/scripts/interactive-cli.mjs');
    assert.equal(manifest['lite-sandbox'], true);
    assert.equal(typeof manifest.container, 'string');
    const source = await fs.readFile(new URL('../scripts/interactive-cli.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /node:child_process|\bspawn\s*\(|\/usr\/bin\/bwrap/);
    assert.doesNotMatch(source, /createBwrapAgentCredentialContext|createContainerAgentCredentialContext/);
    assert.doesNotMatch(source, /env\?\.PLOINKY_RUNTIME|env\.PLOINKY_RUNTIME/);
    assert.match(source, /agentCredentialBootstrap\.mjs/);
    assert.match(source, /providerRuntime\.spawnWith\(\s*dependencies\.spawnTaskSandbox,/);
    assert.match(source, /stdio:\s*\['inherit', 'inherit', 'inherit'\]/);
});
