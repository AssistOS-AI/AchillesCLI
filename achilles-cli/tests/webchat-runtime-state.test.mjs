import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    clearWebchatRuntimeModel,
    createWebchatRuntimeStateEnvelope,
    emitWebchatRuntimeState,
    selectWebchatRuntimeModel,
} from '../src/lib/webchatRuntimeState.mjs';
import {
    getSelectedModel,
    setSelectedModel,
} from '../src/lib/achillesSettings.mjs';

const TEST_RUNTIME_INSTANCE_ID = '123e4567-e89b-42d3-a456-426614174000';

test('runtime-state envelope exposes the selected model and process instance', () => {
    assert.deepEqual(createWebchatRuntimeStateEnvelope('  provider/deep  ', {
        runtimeInstanceId: TEST_RUNTIME_INSTANCE_ID,
    }), {
        __webchatRuntimeState: 1,
        version: 1,
        model: 'provider/deep',
        runtimeInstanceId: TEST_RUNTIME_INSTANCE_ID,
    });
    assert.deepEqual(createWebchatRuntimeStateEnvelope(null, {
        runtimeInstanceId: TEST_RUNTIME_INSTANCE_ID,
    }), {
        __webchatRuntimeState: 1,
        version: 1,
        model: null,
        runtimeInstanceId: TEST_RUNTIME_INSTANCE_ID,
    });

    const writes = [];
    emitWebchatRuntimeState('deep', {
        write: (value) => writes.push(value),
        runtimeInstanceId: TEST_RUNTIME_INSTANCE_ID,
    });
    assert.equal(
        writes[0],
        `{"__webchatRuntimeState":1,"version":1,"model":"deep","runtimeInstanceId":"${TEST_RUNTIME_INSTANCE_ID}"}\n`,
    );
});

test('runtime-state emissions keep one generated instance id for the process lifetime', () => {
    const first = createWebchatRuntimeStateEnvelope('fast');
    const second = createWebchatRuntimeStateEnvelope('deep');

    assert.match(
        first.runtimeInstanceId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.equal(second.runtimeInstanceId, first.runtimeInstanceId);
});

test('/model persistence is read back before publishing the WebChat runtime state', (t) => {
    const workingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-model-state-'));
    t.after(() => fs.rmSync(workingDir, { recursive: true, force: true }));
    const emissions = [];
    const slashState = { activeTier: 'fast', pinnedModel: null };

    const selected = selectWebchatRuntimeModel({
        workingDir,
        model: 'deep',
        slashState,
        emitRuntimeState: (model) => emissions.push(model),
    });

    assert.equal(selected, 'deep');
    assert.equal(getSelectedModel(workingDir), 'deep');
    assert.equal(slashState.pinnedModel, 'deep');
    assert.deepEqual(emissions, ['deep']);
});

test('/tier clearing removes the persisted model before publishing an empty state', (t) => {
    const workingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-tier-state-'));
    t.after(() => fs.rmSync(workingDir, { recursive: true, force: true }));
    setSelectedModel(workingDir, 'plan');
    const emissions = [];
    const slashState = { activeTier: 'fast', pinnedModel: 'plan' };

    const selected = clearWebchatRuntimeModel({
        workingDir,
        slashState,
        emitRuntimeState: (model) => emissions.push(model),
    });

    assert.equal(selected, null);
    assert.equal(getSelectedModel(workingDir), null);
    assert.equal(slashState.pinnedModel, null);
    assert.deepEqual(emissions, [null]);
});

test('the WebChat entrypoint publishes settings state at startup and after slash changes', () => {
    const entrypoint = fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8');
    assert.match(entrypoint, /pinnedModel: getSelectedModel\(workingDir\)[\s\S]*emitWebchatRuntimeState\(slashState\.pinnedModel\)/);
    assert.match(entrypoint, /clearWebchatRuntimeModel\(\{/);
    assert.match(entrypoint, /selectWebchatRuntimeModel\(\{/);
});
