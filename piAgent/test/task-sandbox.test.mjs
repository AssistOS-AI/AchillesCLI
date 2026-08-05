import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
    __testables,
    buildTaskSandboxLaunch,
    buildTaskSandboxPolicy,
    spawnTaskSandbox,
} from '../scripts/task-sandbox.mjs';

function canonicalStub() {
    const calls = [];
    const providerSandbox = {
        PROVIDER_SANDBOX_MODES: Object.freeze({ TASK: 'task', READINESS: 'readiness' }),
        buildProviderSandboxPolicy(input) {
            calls.push({ method: 'policy', input });
            return Object.freeze({ kind: 'policy', input });
        },
        buildProviderSandboxLaunch(input) {
            calls.push({ method: 'launch', input });
            return Object.freeze({ kind: 'launch', input });
        },
        spawnProviderSandbox(input, lifecycle) {
            calls.push({ method: 'spawn', input, lifecycle });
            return Object.freeze({ kind: 'runtime', input, lifecycle });
        },
    };
    return { calls, providerSandbox };
}

function taskInput() {
    return {
        credentialContext: Object.freeze({ trusted: true }),
        workdir: 'project with spaces',
        args: ['--mode', 'json'],
        environment: {
            LANG: 'C.UTF-8',
            PLOINKY_TASK_BROKER_URL: 'http://127.0.0.1:43123/v1',
            PLOINKY_TASK_BROKER_KEY: 'a'.repeat(43),
        },
    };
}

function deferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

test('PI policy and launch adapters delegate exact task inputs to the canonical API', async () => {
    const { calls, providerSandbox } = canonicalStub();
    const input = taskInput();

    const policy = await buildTaskSandboxPolicy(input, { providerSandbox });
    const launch = await buildTaskSandboxLaunch(input, { providerSandbox });

    assert.equal(policy.kind, 'policy');
    assert.equal(launch.kind, 'launch');
    assert.deepEqual(calls.map(({ method }) => method), ['policy', 'launch']);
    for (const call of calls) {
        assert.equal(call.input.mode, 'task');
        assert.equal(call.input.provider, 'pi');
        assert.equal(call.input.credentialContext, input.credentialContext);
        assert.equal(call.input.workdir, input.workdir);
        assert.deepEqual(call.input.command, [
            '/home/agent/.local/bin/pi',
            ...input.args,
        ]);
        assert.equal(Object.hasOwn(call.input, 'args'), false);
        assert.deepEqual(call.input.environment, input.environment);
        assert.equal(Object.hasOwn(call.input, 'createProjectDir'), false);
        assert.equal(Object.hasOwn(call.input, 'readOnlyPaths'), false);
        assert.equal(Object.hasOwn(call.input, 'writablePaths'), false);
    }
});

test('PI spawn adapter delegates lifecycle without exposing helper dependencies', async () => {
    const { calls, providerSandbox } = canonicalStub();
    const input = taskInput();
    const lifecycle = Object.freeze({
        activateCapability() {},
        deactivateCapability() {},
        leaseMetadata: Object.freeze({ taskId: 'pi-task-1' }),
    });

    const runtime = await spawnTaskSandbox(input, lifecycle, { providerSandbox });

    assert.equal(runtime.kind, 'runtime');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input.provider, 'pi');
    assert.equal(calls[0].input.mode, 'task');
    assert.equal(calls[0].lifecycle, lifecycle);
    assert.equal(calls[0].input.credentialContext, input.credentialContext);
});

test('PI spawn adapter rejects an already-aborted lifecycle before module loading', async () => {
    const { providerSandbox } = canonicalStub();
    const controller = new AbortController();
    const reason = new Error('cancel before PI provider bootstrap');
    controller.abort(reason);
    let moduleLoads = 0;
    const pendingModule = {
        then(resolve) {
            moduleLoads += 1;
            resolve(providerSandbox);
        },
    };

    await assert.rejects(
        spawnTaskSandbox(
            taskInput(),
            { signal: controller.signal },
            { providerSandbox: pendingModule },
        ),
        (error) => error === reason,
    );
    assert.equal(moduleLoads, 0);
});

test('PI spawn adapter does not launch after cancellation during module loading', async () => {
    const { calls, providerSandbox } = canonicalStub();
    const moduleLoad = deferred();
    const controller = new AbortController();
    const reason = new Error('cancel during PI provider bootstrap');

    const pendingSpawn = spawnTaskSandbox(
        taskInput(),
        { signal: controller.signal },
        { providerSandbox: moduleLoad.promise },
    );
    await Promise.resolve();
    controller.abort(reason);
    moduleLoad.resolve(providerSandbox);

    await assert.rejects(pendingSpawn, (error) => error === reason);
    assert.deepEqual(calls, []);
});

test('PI task adapter fails closed without context or with policy override attempts', async () => {
    const { providerSandbox } = canonicalStub();
    for (const invalidContext of [
        {},
        { credentialContext: undefined },
        { credentialContext: null },
    ]) {
        await assert.rejects(
            buildTaskSandboxPolicy({ workdir: 'project', ...invalidContext }, { providerSandbox }),
            /requires credentialContext/,
        );
    }
    for (const override of [
        { mode: 'readiness' },
        { provider: 'opencode' },
    ]) {
        await assert.rejects(
            buildTaskSandboxLaunch({ ...taskInput(), ...override }, { providerSandbox }),
            /owns its fixed provider and mode/,
        );
    }
    await assert.rejects(
        spawnTaskSandbox(taskInput(), {}, {
            providerSandbox,
            helperPath: '/tmp/attacker-helper',
        }),
        /unsupported provider sandbox dependency helperPath/,
    );
    await assert.rejects(
        buildTaskSandboxLaunch({ ...taskInput(), command: ['/tmp/pi'] }, { providerSandbox }),
        /unsupported field command/,
    );
    await assert.rejects(
        buildTaskSandboxPolicy(Object.create(taskInput()), { providerSandbox }),
        /plain input object/,
    );
    const accessorInput = taskInput();
    Object.defineProperty(accessorInput, 'args', { get: () => ['--version'] });
    await assert.rejects(
        buildTaskSandboxPolicy(accessorInput, { providerSandbox }),
        /must be a data property/,
    );
    await assert.rejects(
        buildTaskSandboxPolicy(taskInput(), Object.create({ providerSandbox })),
        /must be a plain object/,
    );
    const accessorDependencies = {};
    Object.defineProperty(accessorDependencies, 'providerSandbox', {
        get: () => providerSandbox,
    });
    await assert.rejects(
        buildTaskSandboxPolicy(taskInput(), accessorDependencies),
        /must be a data property/,
    );
});

test('PI task adapter contains no local sandbox policy or path fallback', async () => {
    assert.equal(__testables.PROVIDER, 'pi');
    assert.equal(__testables.PROVIDER_EXECUTABLE, '/home/agent/.local/bin/pi');
    assert.equal(__testables.PROVIDER_SANDBOX_MODULE, '/Agent/lib/providerSandbox.mjs');
    const source = await fs.readFile(new URL('../scripts/task-sandbox.mjs', import.meta.url), 'utf8');
    assert.match(source, /import\('\/Agent\/lib\/providerSandbox\.mjs'\)/);
    for (const forbidden of [
        '/usr/bin/bwrap',
        '/root',
        'PLOINKY_WORKSPACE_ROOT',
        'createProjectDir',
        'probeNestedBubblewrap',
        'process.env',
        'node:child_process',
        'node:fs',
        'realpath',
        'mkdir',
    ]) {
        assert.equal(source.includes(forbidden), false, forbidden);
    }
});
