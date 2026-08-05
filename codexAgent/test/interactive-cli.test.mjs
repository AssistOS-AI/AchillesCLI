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
            randomUUID: () => '22222222-2222-4222-8222-222222222222',
            spawnTaskSandbox,
        },
    };
}

test('Codex interactive adapter prepends fixed defense flags and preserves provider argv exactly', async () => {
    const { runInteractiveCli } = await import('../scripts/interactive-cli.mjs');
    const { calls, dependencies, credentialContext } = fixture();
    const env = { PLOINKY_RUNTIME: 'container', COLORTERM: 'truecolor' };
    const result = await runInteractiveCli(
        ['--workdir', '/workspace/project with spaces', '--', 'exec', '--json', 'task 🧪'],
        env,
        dependencies,
    );

    assert.deepEqual(result, { code: 0, signal: null });
    assert.deepEqual(calls[0], ['bootstrap', env]);
    assert.deepEqual(calls[1], ['broker-start', { credentialContext }]);
    assert.equal(calls[2][0], 'runtime-create');
    assert.equal(calls[2][1].provider, 'codex');
    assert.equal(calls[3][0], 'spawn');
    assert.equal(calls[3][1], spawnTaskSandbox);
    assert.deepEqual(calls[3][2], {
        workdir: '/workspace/project with spaces',
        args: [
            '--sandbox',
            'workspace-write',
            '--ask-for-approval',
            'never',
            'exec',
            '--json',
            'task 🧪',
        ],
    });
    assert.deepEqual(calls[3][3], {
        environment: { COLORTERM: 'truecolor' },
        leaseMetadata: { purpose: 'codex-interactive' },
        stdio: ['inherit', 'inherit', 'inherit'],
    });
});

test('Codex invalid/root workdir fails before trusted context and broker bootstrap', async () => {
    const { runInteractiveCli } = await import('../scripts/interactive-cli.mjs');
    for (const [workdir, code] of [
        ['/workspace', 'PLOINKY_WORKDIR_ROOT_FORBIDDEN'],
        ['project/../escape', 'PLOINKY_WORKDIR_INVALID'],
        ['/outside/project', 'PLOINKY_WORKDIR_INVALID'],
    ]) {
        const { calls, dependencies } = fixture();
        await assert.rejects(
            runInteractiveCli(['--workdir', workdir, '--'], {}, dependencies),
            (error) => error?.code === code,
        );
        assert.equal(calls.length, 0);
    }
});

test('Codex checks cancellation on both sides of credential bootstrap', async () => {
    const { runInteractiveCli } = await import('../scripts/interactive-cli.mjs');
    for (const abortDuringBootstrap of [false, true]) {
        const { calls, dependencies } = fixture();
        const controller = new AbortController();
        const reason = Object.assign(new Error('cancelled'), { signal: 'SIGINT', exitCode: 130 });
        if (abortDuringBootstrap) {
            const bootstrap = dependencies.bootstrapAgentCredentialContext;
            dependencies.bootstrapAgentCredentialContext = (env) => {
                const context = bootstrap(env);
                controller.abort(reason);
                return context;
            };
        } else {
            controller.abort(reason);
        }

        await assert.rejects(
            runInteractiveCli(
                ['--workdir', '/workspace/project', '--', 'exec'],
                {},
                { ...dependencies, signal: controller.signal },
            ),
            (error) => error === reason,
        );
        assert.deepEqual(calls, abortDuringBootstrap ? [['bootstrap', {}]] : []);
    }
});

test('Codex SIGINT during broker bootstrap never creates a provider runtime and exits 130 after cleanup', async () => {
    const { runInteractiveMain } = await import('../scripts/interactive-cli.mjs');
    const calls = [];
    let releaseBroker;
    let brokerStarted;
    const brokerGate = new Promise((resolve) => { releaseBroker = resolve; });
    const brokerStartedGate = new Promise((resolve) => { brokerStarted = resolve; });
    const runtimeProcess = Object.assign(new EventEmitter(), {
        argv: ['node', '/code/scripts/interactive-cli.mjs', '--workdir', '/workspace/project', '--', 'exec'],
        env: {},
        exitCode: undefined,
    });
    const dependencies = {
        bootstrapAgentCredentialContext() {
            calls.push('bootstrap');
            return Object.freeze({ fixture: 'trusted-context' });
        },
        async startScopedSoulBrokerRegistry() {
            calls.push('broker-start');
            brokerStarted();
            await brokerGate;
            return Object.freeze({ async close() { calls.push('broker-close'); } });
        },
        createProviderTaskRuntime() {
            calls.push('runtime-create');
            return {
                async spawnWith() {
                    calls.push('spawn');
                    return { completion: Promise.resolve({ code: null, signal: 'SIGTERM' }) };
                },
                assertBoundaryUsed() { calls.push('boundary'); },
                async close() { calls.push('runtime-close'); },
            };
        },
        randomUUID: () => '22222222-2222-4222-8222-222222222222',
        spawnTaskSandbox,
    };

    const mainPromise = runInteractiveMain(runtimeProcess, async () => dependencies);
    await brokerStartedGate;
    assert.equal(runtimeProcess.emit('SIGINT'), true);
    releaseBroker();
    await mainPromise;

    assert.deepEqual(calls, ['bootstrap', 'broker-start', 'broker-close']);
    assert.equal(runtimeProcess.exitCode, 130);
    assert.equal(runtimeProcess.listenerCount('SIGINT'), 0);
    assert.equal(runtimeProcess.listenerCount('SIGTERM'), 0);
    assert.equal(runtimeProcess.listenerCount('SIGHUP'), 0);
});

test('Codex SIGINT retains exit 130 when cancelled broker cleanup fails', async () => {
    const { runInteractiveMain } = await import('../scripts/interactive-cli.mjs');
    let brokerStarted;
    let releaseBroker;
    const started = new Promise((resolve) => { brokerStarted = resolve; });
    const release = new Promise((resolve) => { releaseBroker = resolve; });
    const runtimeProcess = Object.assign(new EventEmitter(), {
        argv: ['node', '/code/scripts/interactive-cli.mjs', '--workdir', '/workspace/project', '--', 'exec'],
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
        randomUUID: () => '22222222-2222-4222-8222-222222222222',
        spawnTaskSandbox,
    };
    const pending = runInteractiveMain(runtimeProcess, async () => dependencies);
    await started;
    runtimeProcess.emit('SIGINT');
    releaseBroker();
    await pending;
    assert.equal(runtimeProcess.exitCode, 130);
});

test('Codex main leaves unrelated startup failures for the generic exit-1 boundary', async () => {
    const { runInteractiveMain } = await import('../scripts/interactive-cli.mjs');
    const runtimeProcess = Object.assign(new EventEmitter(), {
        argv: ['node', '/code/scripts/interactive-cli.mjs'],
        env: {},
        exitCode: undefined,
    });
    const failure = new Error('dependency load failed');

    await assert.rejects(runInteractiveMain(runtimeProcess, async () => { throw failure; }), failure);
    assert.equal(runtimeProcess.exitCode, undefined);
    assert.equal(runtimeProcess.listenerCount('SIGINT'), 0);
    assert.equal(runtimeProcess.listenerCount('SIGTERM'), 0);
    assert.equal(runtimeProcess.listenerCount('SIGHUP'), 0);
});

test('Codex cleanup remains null-safe and closes broker after runtime cleanup fails', async () => {
    const { __testables } = await import('../scripts/interactive-cli.mjs');
    const calls = [];
    const runtimeFailure = new Error('runtime close failed');
    const runtime = { async close() { calls.push('runtime-close'); throw runtimeFailure; } };
    const broker = { async close() { calls.push('broker-close'); } };

    await __testables.closeInteractiveOwnership(null, null);
    await assert.rejects(__testables.closeInteractiveOwnership(runtime, broker), runtimeFailure);
    assert.deepEqual(calls, ['runtime-close', 'broker-close']);
});

test('Codex manifest uses its canonical dual-mode interactive adapter', async () => {
    const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
    assert.equal(manifest.cli, 'node /code/scripts/interactive-cli.mjs');
    assert.equal(manifest['lite-sandbox'], true);
    assert.equal(typeof manifest.container, 'string');
    const source = await fs.readFile(new URL('../scripts/interactive-cli.mjs', import.meta.url), 'utf8');
    assert.match(source, /agentCredentialBootstrap\.mjs/);
    assert.match(source, /providerRuntime\.spawnWith\(\s*dependencies\.spawnTaskSandbox,/);
    assert.doesNotMatch(source, /node:child_process|createBwrapAgentCredentialContext|createContainerAgentCredentialContext/);
});
