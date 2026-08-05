import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
    __testables,
    checkTaskSandboxReadiness,
} from '../scripts/check-task-sandbox.mjs';

function readinessStub(result = Object.freeze({ code: 0, signal: null })) {
    const calls = [];
    const launch = Object.freeze({
        mode: 'readiness',
        provider: 'pi',
        cwd: '/workspace/readiness',
    });
    const providerSandbox = {
        PROVIDER_SANDBOX_MODES: Object.freeze({ TASK: 'task', READINESS: 'readiness' }),
        spawnProviderSandbox(input, lifecycle) {
            calls.push({ input, lifecycle });
            return Object.freeze({ launch, completion: Promise.resolve(result) });
        },
    };
    return { calls, launch, providerSandbox };
}

test('PI readiness delegates empty-workspace mode with explicit credential context', async () => {
    const { calls, launch, providerSandbox } = readinessStub();
    const credentialContext = Object.freeze({ trusted: true });
    const lifecycle = Object.freeze({ leaseMetadata: Object.freeze({ readiness: true }) });

    const readiness = await checkTaskSandboxReadiness({
        credentialContext,
        lifecycle,
        dependencies: { providerSandbox },
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].input, {
        mode: 'readiness',
        provider: 'pi',
        credentialContext,
    });
    assert.equal(calls[0].lifecycle, lifecycle);
    assert.equal(readiness.launch, launch);
    assert.deepEqual(readiness.result, { code: 0, signal: null });
    assert.equal(Object.isFrozen(readiness), true);
});

test('PI readiness rejects missing context and provider failure', async () => {
    const success = readinessStub();
    for (const credentialContext of [undefined, null]) {
        await assert.rejects(
            checkTaskSandboxReadiness({
                credentialContext,
                dependencies: { providerSandbox: success.providerSandbox },
            }),
            /requires credentialContext/,
        );
    }
    assert.equal(success.calls.length, 0);

    await assert.rejects(
        checkTaskSandboxReadiness({
            credentialContext: Object.freeze({ trusted: true }),
            dependencies: Object.create({ providerSandbox: success.providerSandbox }),
        }),
        /must be a plain object/,
    );
    const accessorDependencies = {};
    Object.defineProperty(accessorDependencies, 'providerSandbox', {
        get: () => success.providerSandbox,
    });
    await assert.rejects(
        checkTaskSandboxReadiness({
            credentialContext: Object.freeze({ trusted: true }),
            dependencies: accessorDependencies,
        }),
        /must be a data property/,
    );

    for (const result of [
        { code: 7, signal: null },
        { code: null, signal: 'SIGTERM' },
    ]) {
        const failed = readinessStub(result);
        await assert.rejects(
            checkTaskSandboxReadiness({
                credentialContext: Object.freeze({ trusted: true }),
                dependencies: { providerSandbox: failed.providerSandbox },
            }),
            (error) => error?.code === 'PLOINKY_PROVIDER_READINESS_FAILED',
        );
    }
});

test('PI readiness has no standalone identity, real-workspace, or direct provider fallback', async () => {
    assert.equal(__testables.PROVIDER, 'pi');
    assert.equal(__testables.PROVIDER_SANDBOX_MODULE, '/Agent/lib/providerSandbox.mjs');
    const moduleSource = await fs.readFile(
        new URL('../scripts/check-task-sandbox.mjs', import.meta.url),
        'utf8',
    );
    for (const forbidden of [
        'process.env',
        'PLOINKY_WORKSPACE_ROOT',
        '/usr/bin/bwrap',
        '/root',
        'spawnSync',
        '--version',
        'readAgentCredentialDescriptor',
    ]) {
        assert.equal(moduleSource.includes(forbidden), false, forbidden);
    }

    const shellSource = await fs.readFile(new URL('../readiness.sh', import.meta.url), 'utf8');
    assert.match(shellSource, /\$HOME\/\.local\/bin\/pi/);
    assert.match(shellSource, /@earendil-works\/pi-coding-agent/);
    assert.doesNotMatch(shellSource, /HOME:-}" = "\/(?:home\/agent|root)"/);
    for (const forbidden of ['/root/', '/home/agent/', 'check-task-sandbox', 'node /code', '--version']) {
        assert.equal(shellSource.includes(forbidden), false, forbidden);
    }
});
