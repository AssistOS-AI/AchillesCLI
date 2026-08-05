import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
    __testables as credentialContextTestables,
} from '../../../Ploinky/Agent/lib/agentCredentialContext.mjs';
import * as providerSandboxModule from '../../../Ploinky/Agent/lib/providerSandbox.mjs';
import { buildBwrapAgentCredential } from '../../../Ploinky/cli/sandbox/bwrap/bwrapAgentCredential.js';
import {
    buildTaskSandboxLaunch,
    buildTaskSandboxPolicy,
    spawnTaskSandbox,
} from '../scripts/task-sandbox.mjs';
import { checkTaskSandboxReadiness } from '../scripts/check-task-sandbox.mjs';

const BROKER_URL = 'http://127.0.0.1:43123/v1';
const BROKER_KEY = 'c'.repeat(43);
const OPENCODE_SANDBOX_EXECUTABLE = '/home/agent/.opencode/bin/opencode';

function credentialContext() {
    const principalId = 'agent:AchillesCLI/opencodeAgent';
    const generated = buildBwrapAgentCredential({
        principalId,
        instanceId: 'opencodeAgent_alias-1',
        enableGeneration: 'generation-opencode-1',
        runtimeKey: 'opencodeAgent_alias-1',
        routeKey: 'opencodeAgent',
        router: {
            physicalOrigin: 'http://127.0.0.1:8080',
            requestAuthority: '127.0.0.1:18080',
            host: '127.0.0.1',
            port: 8080,
        },
        admission: {
            runtimeKind: 'bwrap',
            manifestDigest: `sha256:${'1'.repeat(64)}`,
            capabilityDigest: `sha256:${'2'.repeat(64)}`,
            networkHash: `sha256:${'3'.repeat(64)}`,
        },
    }, {
        now: Math.floor(Date.now() / 1000) - 10,
        randomBytes: () => Buffer.alloc(32, 7),
        buildCredentialEnv: () => ({
            PLOINKY_AGENT_SECRET: 'a'.repeat(64),
            PLOINKY_AGENT_PRIVATE_SECRET: 'b'.repeat(64),
            PLOINKY_AGENT_API_KEY: `${principalId}|fixture-signature`,
            PLOINKY_AGENT_API_PUBLIC_KEY: Buffer.alloc(32, 8).toString('base64url'),
        }),
    });
    return credentialContextTestables.createBwrapContextFromRead({
        descriptor: generated.descriptor,
        publicAttestation: generated.publicAttestation,
    });
}

function taskInput(overrides = {}) {
    return {
        credentialContext: credentialContext(),
        workdir: 'projects/alpha',
        args: ['run', '--auto'],
        environment: {
            PLOINKY_TASK_BROKER_URL: BROKER_URL,
            PLOINKY_TASK_BROKER_KEY: BROKER_KEY,
        },
        ...overrides,
    };
}

function record(policy, type, predicate = () => true) {
    return policy.records.find((candidate) => candidate.type === type && predicate(candidate));
}

test('OpenCode task adapter delegates the exact canonical task policy', async () => {
    const policy = await buildTaskSandboxPolicy(taskInput(), { providerSandboxModule });

    assert.equal(policy.mode, providerSandboxModule.PROVIDER_SANDBOX_MODES.TASK);
    assert.equal(policy.provider, providerSandboxModule.PROVIDER_SANDBOX_PROVIDERS.OPENCODE);
    assert.equal(policy.workdir, 'projects/alpha');
    assert.deepEqual(policy.command, [OPENCODE_SANDBOX_EXECUTABLE, 'run', '--auto']);
    assert.deepEqual(record(policy, 'WORKSPACE'), { type: 'WORKSPACE', mode: 'ro' });
    assert.deepEqual(record(policy, 'WORKDIR'), { type: 'WORKDIR', path: 'projects/alpha' });
    assert.ok(record(policy, 'TMPFS', ({ target }) => target === '/workspace/.ploinky'));
    assert.ok(record(policy, 'TMPFS', ({ target }) => target === '/workspace/.data'));
    assert.ok(record(policy, 'HOME', ({ sourceKind, homeKey }) => (
        sourceKind === 'sandbox-workspace-v2'
        && homeKey === 'opencodeAgent_alias-1.sandbox-v2'
    )));
    assert.ok(record(policy, 'RO_PATH', ({ target }) => target === OPENCODE_SANDBOX_EXECUTABLE));
    assert.ok(record(policy, 'PROC'));
    assert.equal(policy.env.HOME, '/home/agent');
    assert.equal(policy.env.PLOINKY_TASK_BROKER_URL, BROKER_URL);
    assert.equal(policy.env.PLOINKY_TASK_BROKER_KEY, BROKER_KEY);
    assert.equal(JSON.stringify(policy).includes('/root'), false);
});

test('OpenCode launch uses only the canonical helper descriptor transport', async () => {
    const launch = await buildTaskSandboxLaunch(taskInput(), { providerSandboxModule });

    assert.equal(launch.helper, providerSandboxModule.PROVIDER_SANDBOX_HELPER);
    assert.deepEqual(launch.args, []);
    assert.ok(Buffer.isBuffer(launch.descriptor));
    assert.equal(launch.descriptor.subarray(0, 8).toString('ascii'), 'PLBWLP02');
    assert.equal(launch.command[0], OPENCODE_SANDBOX_EXECUTABLE);
});

test('OpenCode adapter rejects legacy policy, path, and directory-creation inputs', async () => {
    for (const field of [
        ['createProjectDir', true],
        ['command', '/tmp/opencode'],
        ['projectDir', '/workspace/projects/alpha'],
        ['readOnlyPaths', ['/tmp']],
        ['writablePaths', ['/workspace']],
    ]) {
        await assert.rejects(
            buildTaskSandboxPolicy(taskInput({ [field[0]]: field[1] }), { providerSandboxModule }),
            new RegExp(`unknown field ${field[0]}`),
        );
    }
    await assert.rejects(
        buildTaskSandboxPolicy(taskInput({ workdir: '/workspace' }), { providerSandboxModule }),
        (error) => error?.code === 'PLOINKY_WORKDIR_ROOT_FORBIDDEN',
    );
    for (const workdir of ['', '.', '.data', '.ploinky']) {
        await assert.rejects(
            buildTaskSandboxPolicy(taskInput({ workdir }), { providerSandboxModule }),
            (error) => error?.code === (
                workdir === '' || workdir === '.'
                    ? 'PLOINKY_WORKDIR_ROOT_FORBIDDEN'
                    : 'PLOINKY_WORKDIR_INVALID'
            ),
        );
    }
    await assert.rejects(
        buildTaskSandboxPolicy(taskInput({ args: 'run' }), { providerSandboxModule }),
        /args must be an array/,
    );
    await assert.rejects(
        buildTaskSandboxPolicy(taskInput({ environment: {} }), { providerSandboxModule }),
        (error) => error?.code === 'PLOINKY_PROVIDER_BROKER_REQUIRED',
    );
    await assert.rejects(
        buildTaskSandboxPolicy(taskInput({
            environment: {
                PLOINKY_TASK_BROKER_URL: BROKER_URL,
                PLOINKY_TASK_BROKER_KEY: BROKER_KEY,
                OPENAI_API_KEY: 'forbidden',
            },
        }), { providerSandboxModule }),
        (error) => error?.code === 'PLOINKY_PROVIDER_ENV_INVALID',
    );
    await assert.rejects(
        buildTaskSandboxPolicy(taskInput(), {
            providerSandboxModule,
            bwrapPath: '/usr/bin/bwrap',
        }),
        /unknown field bwrapPath/,
    );
});

test('OpenCode spawn adapter forwards lifecycle through the canonical spawner', async () => {
    const expected = Object.freeze({ child: {}, completion: Promise.resolve({ code: 0, signal: null }) });
    const captured = [];
    const injectedModule = {
        ...providerSandboxModule,
        spawnProviderSandbox(input, lifecycle, dependencies) {
            captured.push({ input, lifecycle, dependencies });
            return expected;
        },
    };
    const lifecycle = { activateCapability() {}, deactivateCapability() {} };
    const providerSpawnDependencies = { spawn() {} };

    assert.equal(await spawnTaskSandbox(taskInput(), lifecycle, {
        providerSandboxModule: injectedModule,
        providerSpawnDependencies,
    }), expected);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].input.mode, providerSandboxModule.PROVIDER_SANDBOX_MODES.TASK);
    assert.equal(captured[0].input.provider, 'opencode');
    assert.equal(captured[0].input.command[0], OPENCODE_SANDBOX_EXECUTABLE);
    assert.equal(captured[0].lifecycle, lifecycle);
    assert.equal(captured[0].dependencies, providerSpawnDependencies);
});

test('OpenCode readiness launches harmless startup in the canonical empty workspace', async () => {
    let readinessPolicy = null;
    let readinessLifecycle = null;
    const injectedModule = {
        ...providerSandboxModule,
        spawnProviderSandbox(input, lifecycle) {
            readinessPolicy = providerSandboxModule.buildProviderSandboxPolicy(input);
            readinessLifecycle = lifecycle;
            return {
                completion: Promise.resolve({ code: 0, signal: null }),
            };
        },
    };

    const result = await checkTaskSandboxReadiness({
        credentialContext: credentialContext(),
    }, { providerSandboxModule: injectedModule });

    assert.deepEqual(result, {
        mode: providerSandboxModule.PROVIDER_SANDBOX_MODES.READINESS,
        provider: 'opencode',
        code: 0,
        signal: null,
    });
    assert.equal(readinessPolicy.mode, providerSandboxModule.PROVIDER_SANDBOX_MODES.READINESS);
    assert.equal(record(readinessPolicy, 'WORKSPACE'), undefined);
    assert.equal(record(readinessPolicy, 'WORKDIR'), undefined);
    assert.ok(record(readinessPolicy, 'TMPFS', ({ target }) => target === '/workspace'));
    assert.ok(record(readinessPolicy, 'DIR', ({ target }) => target === '/workspace/readiness'));
    assert.ok(record(readinessPolicy, 'PROC'));
    assert.deepEqual(readinessPolicy.command, [OPENCODE_SANDBOX_EXECUTABLE, '--version']);
    assert.equal(readinessPolicy.env.PLOINKY_TASK_BROKER_URL, undefined);
    assert.deepEqual(readinessLifecycle.stdio, ['ignore', 'ignore', 'ignore']);
    assert.deepEqual(readinessLifecycle.leaseMetadata, { purpose: 'provider-readiness' });
});

test('OpenCode readiness fails closed on provider exit or missing context', async () => {
    const failedModule = {
        ...providerSandboxModule,
        spawnProviderSandbox() {
            return { completion: Promise.resolve({ code: 19, signal: null }) };
        },
    };
    await assert.rejects(
        checkTaskSandboxReadiness({ credentialContext: credentialContext() }, {
            providerSandboxModule: failedModule,
        }),
        (error) => error?.code === 'PLOINKY_PROVIDER_READINESS_FAILED'
            && /exit 19/.test(error.message),
    );
    await assert.rejects(
        checkTaskSandboxReadiness({ credentialContext: null }, { providerSandboxModule }),
        (error) => error?.code === 'PLOINKY_AGENT_CREDENTIAL_CONTEXT_REQUIRED',
    );
});

test('OpenCode adapters contain no local sandbox, raw bwrap, or path fallback', async () => {
    const taskSource = await fs.readFile(
        new URL('../scripts/task-sandbox.mjs', import.meta.url),
        'utf8',
    );
    const readinessSource = await fs.readFile(
        new URL('../scripts/check-task-sandbox.mjs', import.meta.url),
        'utf8',
    );
    const readinessShell = await fs.readFile(
        new URL('../readiness.sh', import.meta.url),
        'utf8',
    );

    for (const source of [taskSource, readinessSource]) {
        assert.match(source, /import\('\/Agent\/lib\/providerSandbox\.mjs'\)/);
        for (const forbidden of [
            '/usr/bin/bwrap',
            "from 'node:child_process'",
            "from 'node:fs'",
            "from 'node:path'",
            'PLOINKY_WORKSPACE_ROOT',
            'createProjectDir',
            'probeNestedBubblewrap',
            'inherited',
            '/root',
        ]) {
            assert.equal(source.includes(forbidden), false, forbidden);
        }
    }
    assert.match(readinessShell, /\$HOME\/\.opencode\/bin\/opencode/);
    assert.doesNotMatch(readinessShell, /HOME:-}" = "\/(?:home\/agent|root)"/);
    assert.match(readinessShell, /scripts\/ensure-bubblewrap\.sh/);
    assert.equal(readinessShell.includes('check-task-sandbox.mjs'), false);
    assert.equal(readinessShell.includes('opencode --version'), false);
});
