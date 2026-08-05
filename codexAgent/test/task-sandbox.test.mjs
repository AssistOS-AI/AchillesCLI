import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildTaskSandboxLaunch,
    buildTaskSandboxPolicy,
    spawnTaskSandbox,
} from '../scripts/task-sandbox.mjs';

const credentialContext = Object.freeze({ trusted: true });

function canonicalModule() {
    const calls = [];
    return {
        calls,
        PROVIDER_SANDBOX_MODES: { TASK: 'task' },
        buildProviderSandboxPolicy(input) { calls.push(['policy', input]); return input; },
        buildProviderSandboxLaunch(input) { calls.push(['launch', input]); return input; },
        spawnProviderSandbox(input, lifecycle) {
            calls.push(['spawn', input, lifecycle]);
            return { input, lifecycle };
        },
    };
}

const input = Object.freeze({
    args: ['--sandbox', 'workspace-write', 'exec', '--json', 'Task'],
    credentialContext,
    environment: Object.freeze({ PLOINKY_TASK_BROKER_URL: 'http://127.0.0.1:1/v1' }),
    workdir: '/workspace/project',
});

test('Codex adapter fixes provider, mode, and immutable executable', async () => {
    for (const [operation, method] of [
        ['policy', buildTaskSandboxPolicy],
        ['launch', buildTaskSandboxLaunch],
    ]) {
        const providerSandbox = canonicalModule();
        const result = await method(input, { providerSandbox });
        assert.equal(result.provider, 'codex');
        assert.equal(result.mode, 'task');
        assert.deepEqual(result.command, [
            '/home/agent/.local/bin/codex',
            ...input.args,
        ]);
        assert.equal(result.credentialContext, credentialContext);
        assert.equal(result.workdir, '/workspace/project');
        assert.deepEqual(providerSandbox.calls[0][0], operation);
    }
});

test('Codex adapter delegates spawn and lifecycle to canonical Ploinky policy', async () => {
    const providerSandbox = canonicalModule();
    const lifecycle = Object.freeze({ stdio: ['ignore', 'pipe', 'pipe'] });
    const result = await spawnTaskSandbox(input, lifecycle, { providerSandbox });
    assert.equal(result.lifecycle, lifecycle);
    assert.equal(result.input.provider, 'codex');
    assert.equal(result.input.mode, 'task');
});

test('Codex adapter rejects policy widening and missing credential context', async () => {
    const providerSandbox = canonicalModule();
    await assert.rejects(
        buildTaskSandboxPolicy({ ...input, provider: 'pi' }, { providerSandbox }),
        /unsupported field provider|owns its fixed provider/u,
    );
    await assert.rejects(
        buildTaskSandboxPolicy({ ...input, credentialContext: undefined }, { providerSandbox }),
        /credentialContext/u,
    );
    await assert.rejects(
        buildTaskSandboxPolicy({ ...input, workdir: undefined }, { providerSandbox }),
        /workdir/u,
    );
});
