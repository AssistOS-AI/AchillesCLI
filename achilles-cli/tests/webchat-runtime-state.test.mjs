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

test('runtime-state envelope exposes only the explicitly selected settings model', () => {
    assert.deepEqual(createWebchatRuntimeStateEnvelope('  provider/deep  '), {
        __webchatRuntimeState: 1,
        version: 1,
        model: 'provider/deep',
    });
    assert.deepEqual(createWebchatRuntimeStateEnvelope(null), {
        __webchatRuntimeState: 1,
        version: 1,
        model: null,
    });

    const writes = [];
    emitWebchatRuntimeState('deep', { write: (value) => writes.push(value) });
    assert.equal(writes[0], '{"__webchatRuntimeState":1,"version":1,"model":"deep"}\n');
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
