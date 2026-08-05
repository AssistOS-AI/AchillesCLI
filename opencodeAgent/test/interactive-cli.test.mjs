import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { spawnTaskSandbox } from '../scripts/task-sandbox.mjs';
import { __testables as interactiveTestables } from '../scripts/interactive-cli.mjs';

function fixture() {
    const calls = [];
    const credentialContext = Object.freeze({ fixture: 'credential-context' });
    const brokerRegistry = Object.freeze({
        async close() { calls.push({ type: 'broker-close' }); },
    });
    const runtime = {
        provider: 'opencode',
        mode: 'task',
        async spawnWith(adapter, input, lifecycle) {
            calls.push({ type: 'spawn', adapter, input, lifecycle });
            return {
                completion: Promise.resolve({ code: 0, signal: null }),
            };
        },
        assertBoundaryUsed() { calls.push({ type: 'boundary' }); },
        async close() { calls.push({ type: 'runtime-close' }); },
    };
    const dependencies = {
        createBwrapAgentCredentialContext() {
            calls.push({ type: 'bwrap-context' });
            return credentialContext;
        },
        createContainerAgentCredentialContext(env) {
            calls.push({ type: 'container-context', env });
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

test('interactive CLI parses exact workdir grammar and uses task provider runtime with inherited PTY', async () => {
    const { calls, dependencies, credentialContext, brokerRegistry } = fixture();
    const { runInteractiveCli } = await import('../scripts/interactive-cli.mjs');
    const signal = new AbortController().signal;
    const env = { PLOINKY_RUNTIME: 'bwrap', TERM: 'xterm-256color', HOME: '/home/agent' };
    const result = await runInteractiveCli(
        ['--workdir', 'projects/alpha', '--', '--model', 'soul/plan'],
        env,
        { ...dependencies, signal },
    );

    assert.deepEqual(result, { code: 0, signal: null });
    assert.equal(calls[0].type, 'bwrap-context');
    assert.deepEqual(calls[1], {
        type: 'broker-start',
        input: { credentialContext },
    });
    assert.equal(calls[2].type, 'runtime-create');
    assert.deepEqual(calls[2].input, {
        credentialContext,
        brokerRegistry,
        mode: 'task',
        provider: 'opencode',
        taskId: 'interactive:11111111-1111-4111-8111-111111111111',
        audience: 'interactive:opencode',
        signal,
    });
    assert.equal(calls[3].type, 'spawn');
    assert.equal(calls[3].adapter, spawnTaskSandbox);
    assert.deepEqual(calls[3].input, {
        workdir: 'projects/alpha',
        args: ['--model', 'soul/plan'],
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

test('interactive CLI adapts only exact container-generated environment and rejects unknown runtime', async () => {
    const container = fixture();
    const { runInteractiveCli } = await import('../scripts/interactive-cli.mjs');
    const env = { PLOINKY_RUNTIME: 'container', PLOINKY_AGENT_ID: 'generated-fixture' };
    await runInteractiveCli(['--workdir', 'projects/a', '--'], env, container.dependencies);
    assert.equal(container.calls[0].type, 'container-context');
    assert.equal(container.calls[0].env, env);

    const unknown = fixture();
    await assert.rejects(
        runInteractiveCli(['--workdir', 'projects/a', '--'], {
            PLOINKY_RUNTIME: 'seatbelt',
        }, unknown.dependencies),
        (error) => error?.code === 'PLOINKY_AGENT_CREDENTIAL_CONTEXT_REQUIRED',
    );
    assert.equal(unknown.calls.length, 0);
});

test('interactive CLI rejects legacy grammar before credential or provider work', async () => {
    const { calls, dependencies } = fixture();
    const { runInteractiveCli } = await import('../scripts/interactive-cli.mjs');
    for (const argv of [
        [],
        ['projects/a'],
        ['--workdir', 'projects/a'],
        ['--workdir', '', '--'],
        ['--workdir', 'projects/a', 'run'],
    ]) {
        await assert.rejects(
            runInteractiveCli(argv, { PLOINKY_RUNTIME: 'bwrap' }, dependencies),
            (error) => error?.code === 'PLOINKY_PROVIDER_RUNTIME_INPUT_INVALID',
        );
    }
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

async function runWithDependencies(dependencies) {
    const { runInteractiveCli } = await import('../scripts/interactive-cli.mjs');
    return runInteractiveCli(
        ['--workdir', 'projects/a', '--'],
        { PLOINKY_RUNTIME: 'bwrap' },
        dependencies,
    );
}

test('manifest CLI is the canonical adapter and contains no raw provider path', async () => {
    const manifest = JSON.parse(await fs.readFile(
        new URL('../manifest.json', import.meta.url),
        'utf8',
    ));
    assert.equal(manifest.cli, 'node /code/scripts/interactive-cli.mjs');
    const source = await fs.readFile(
        new URL('../scripts/interactive-cli.mjs', import.meta.url),
        'utf8',
    );
    assert.doesNotMatch(source, /node:child_process|\bspawn\s*\(|\/usr\/bin\/bwrap/);
    assert.doesNotMatch(source, /PLOINKY_ENV_SOURCE_|PLOINKY_AGENT_API_KEY/);
    assert.match(source, /providerRuntime\.spawnWith\(\s*dependencies\.spawnTaskSandbox,/);
    assert.match(source, /stdio:\s*\['inherit', 'inherit', 'inherit'\]/);
});
