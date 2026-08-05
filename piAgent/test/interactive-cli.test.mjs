import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import test from 'node:test';

import { spawnTaskSandbox } from '../scripts/task-sandbox.mjs';

function fixture() {
    const calls = [];
    const credentialContext = Object.freeze({ fixture: 'trusted-context' });
    const brokerRegistry = Object.freeze({ async close() { calls.push(['broker-close']); } });
    const runtime = {
        async spawnWith(adapter, input, lifecycle) {
            calls.push(['spawn', adapter, input, lifecycle]);
            return { completion: Promise.resolve({ code: 0, signal: null }) };
        },
        assertBoundaryUsed() { calls.push(['boundary']); },
        async close() { calls.push(['runtime-close']); },
    };
    return {
        calls,
        credentialContext,
        dependencies: {
            bootstrapAgentCredentialContext(env) {
                calls.push(['bootstrap', env]);
                return credentialContext;
            },
            async startScopedSoulBrokerRegistry(input) {
                calls.push(['broker-start', input]);
                return brokerRegistry;
            },
            createProviderTaskRuntime(input) {
                calls.push(['runtime-create', input]);
                return runtime;
            },
            randomUUID: () => '33333333-3333-4333-8333-333333333333',
            spawnTaskSandbox,
        },
    };
}

test('PI interactive adapter preserves exact argv and enters only the canonical task boundary', async () => {
    const { runInteractiveCli } = await import('../scripts/interactive-cli.mjs');
    const { calls, dependencies, credentialContext } = fixture();
    const env = { PLOINKY_RUNTIME: 'bwrap', TERM: 'screen' };
    const result = await runInteractiveCli(
        ['--workdir', '.ploinky/repos/project/subdir', '--', '--provider', 'anthropic', 'task with spaces'],
        env,
        dependencies,
    );

    assert.deepEqual(result, { code: 0, signal: null });
    assert.deepEqual(calls[0], ['bootstrap', env]);
    assert.deepEqual(calls[1], ['broker-start', { credentialContext }]);
    assert.equal(calls[2][0], 'runtime-create');
    assert.equal(calls[2][1].provider, 'pi');
    assert.equal(calls[3][0], 'spawn');
    assert.equal(calls[3][1], spawnTaskSandbox);
    assert.deepEqual(calls[3][2], {
        workdir: '.ploinky/repos/project/subdir',
        args: ['--provider', 'anthropic', 'task with spaces'],
    });
    assert.deepEqual(calls[3][3], {
        environment: { TERM: 'screen' },
        leaseMetadata: { purpose: 'pi-interactive' },
        stdio: ['inherit', 'inherit', 'inherit'],
    });
});

test('PI has no protected-directory bypass and rejects invalid workdir before bootstrap', async () => {
    const { runInteractiveCli } = await import('../scripts/interactive-cli.mjs');
    for (const workdir of ['.data/pi', '.ploinky/pi', 'pi/../project']) {
        const { calls, dependencies } = fixture();
        await assert.rejects(
            runInteractiveCli(['--workdir', workdir, '--'], {}, dependencies),
            (error) => error?.code === 'PLOINKY_WORKDIR_INVALID',
        );
        assert.equal(calls.length, 0);
    }
});

test('PI SIGINT during broker bootstrap exits 130 without spawning a provider', async () => {
    const { runInteractiveMain } = await import('../scripts/interactive-cli.mjs');
    const calls = [];
    let releaseBroker;
    let markBrokerStarted;
    const brokerRelease = new Promise((resolve) => { releaseBroker = resolve; });
    const brokerStarted = new Promise((resolve) => { markBrokerStarted = resolve; });
    const brokerRegistry = {
        async close() { calls.push(['broker-close']); },
    };
    const dependencies = {
        bootstrapAgentCredentialContext() {
            calls.push(['bootstrap']);
            return Object.freeze({ fixture: 'trusted-context' });
        },
        async startScopedSoulBrokerRegistry() {
            calls.push(['broker-start']);
            markBrokerStarted();
            await brokerRelease;
            return brokerRegistry;
        },
        createProviderTaskRuntime() {
            calls.push(['runtime-create']);
            return {
                async spawnWith() {
                    calls.push(['spawn']);
                    return { completion: Promise.resolve({ code: 0, signal: null }) };
                },
                assertBoundaryUsed() { calls.push(['boundary']); },
                async close() { calls.push(['runtime-close']); },
            };
        },
        randomUUID: () => '33333333-3333-4333-8333-333333333333',
        spawnTaskSandbox,
    };
    const runtimeProcess = new EventEmitter();
    runtimeProcess.argv = [
        process.execPath,
        '/code/scripts/interactive-cli.mjs',
        '--workdir',
        'project',
        '--',
    ];
    runtimeProcess.env = {};
    runtimeProcess.exitCode = undefined;

    const running = runInteractiveMain(runtimeProcess, async () => dependencies);
    await brokerStarted;
    runtimeProcess.emit('SIGINT');
    releaseBroker();
    await running;

    assert.equal(runtimeProcess.exitCode, 130);
    assert.deepEqual(calls, [
        ['bootstrap'],
        ['broker-start'],
        ['broker-close'],
    ]);
    for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        assert.equal(runtimeProcess.listenerCount(name), 0);
    }
});

test('PI SIGINT retains exit 130 when cancelled broker cleanup fails', async () => {
    const { runInteractiveMain } = await import('../scripts/interactive-cli.mjs');
    let brokerStarted;
    let releaseBroker;
    const started = new Promise((resolve) => { brokerStarted = resolve; });
    const release = new Promise((resolve) => { releaseBroker = resolve; });
    const runtimeProcess = Object.assign(new EventEmitter(), {
        argv: [process.execPath, '/code/scripts/interactive-cli.mjs', '--workdir', 'project', '--'],
        env: {}, exitCode: undefined,
    });
    const dependencies = {
        bootstrapAgentCredentialContext: () => Object.freeze({ fixture: true }),
        async startScopedSoulBrokerRegistry() {
            brokerStarted();
            await release;
            return Object.freeze({ async close() { throw new Error('broker close failed'); } });
        },
        createProviderTaskRuntime() { throw new Error('runtime must not be created'); },
        randomUUID: () => '33333333-3333-4333-8333-333333333333',
        spawnTaskSandbox,
    };
    const pending = runInteractiveMain(runtimeProcess, async () => dependencies);
    await started;
    runtimeProcess.emit('SIGINT');
    releaseBroker();
    await pending;
    assert.equal(runtimeProcess.exitCode, 130);
});

test('PI manifest uses its canonical dual-mode interactive adapter', async () => {
    const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
    assert.equal(manifest.cli, 'node /code/scripts/interactive-cli.mjs');
    assert.equal(manifest['lite-sandbox'], true);
    assert.equal(typeof manifest.container, 'string');
    const source = await fs.readFile(new URL('../scripts/interactive-cli.mjs', import.meta.url), 'utf8');
    assert.match(source, /agentCredentialBootstrap\.mjs/);
    assert.match(source, /providerRuntime\.spawnWith\(\s*dependencies\.spawnTaskSandbox,/);
    assert.doesNotMatch(source, /node:child_process|createBwrapAgentCredentialContext|createContainerAgentCredentialContext/);
});
