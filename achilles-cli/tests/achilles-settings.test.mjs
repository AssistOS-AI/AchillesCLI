import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    clearSelectedModel,
    getSelectedModel,
    setSelectedModel,
} from '../src/lib/achillesSettings.mjs';

test('selected model is stored under the workspace .achilles-cli directory', async () => {
    const workingDir = await mkdtemp(join(tmpdir(), 'achilles-settings-'));
    setSelectedModel(workingDir, 'anthropic/claude-sonnet');

    assert.equal(getSelectedModel(workingDir), 'anthropic/claude-sonnet');
    const stored = JSON.parse(await readFile(join(workingDir, '.achilles-cli', 'settings.json'), 'utf8'));
    assert.deepEqual(stored, {
        version: 1,
        model: 'anthropic/claude-sonnet',
    });

    clearSelectedModel(workingDir);
    assert.equal(getSelectedModel(workingDir), null);
});

test('malformed settings fall back without destroying the file', async () => {
    const workingDir = await mkdtemp(join(tmpdir(), 'achilles-settings-invalid-'));
    const settingsDir = join(workingDir, '.achilles-cli');
    await mkdir(settingsDir);
    await writeFile(join(settingsDir, 'settings.json'), '{invalid');

    assert.equal(getSelectedModel(workingDir), null);
    assert.equal(await readFile(join(settingsDir, 'settings.json'), 'utf8'), '{invalid');
});
