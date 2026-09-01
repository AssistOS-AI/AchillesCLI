import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    clearSelectedModel,
    getCurrentSessionId,
    getDisabledSkills,
    getPermissionMode,
    getSelectedModel,
    setPermissionMode,
    setCurrentSessionId,
    setDisabledSkills,
    setSelectedModel,
} from '../src/lib/achillesSettings.mjs';

test('selected model is stored under the workspace .data/achilles-cli directory', async () => {
    const workingDir = await mkdtemp(join(tmpdir(), 'achilles-settings-'));
    setSelectedModel(workingDir, 'anthropic/claude-sonnet');

    assert.equal(getSelectedModel(workingDir), 'anthropic/claude-sonnet');
    const stored = JSON.parse(await readFile(join(workingDir, '.data', 'achilles-cli', 'settings.json'), 'utf8'));
    assert.deepEqual(stored, {
        model: 'anthropic/claude-sonnet',
    });

    clearSelectedModel(workingDir);
    assert.equal(getSelectedModel(workingDir), null);
});

test('disabled skills are stored per workspace and preserve unrelated settings', async () => {
    const workingDir = await mkdtemp(join(tmpdir(), 'achilles-disabled-skills-'));
    setSelectedModel(workingDir, 'test/model');
    assert.deepEqual(setDisabledSkills(workingDir, ['beta-cskill', 'alpha-oskill', 'beta-cskill']), [
        'alpha-oskill',
        'beta-cskill',
    ]);
    assert.deepEqual(getDisabledSkills(workingDir), ['alpha-oskill', 'beta-cskill']);
    const stored = JSON.parse(await readFile(join(workingDir, '.data', 'achilles-cli', 'settings.json'), 'utf8'));
    assert.equal(stored.model, 'test/model');

    setDisabledSkills(workingDir, []);
    assert.deepEqual(getDisabledSkills(workingDir), []);
    assert.equal(Object.hasOwn(JSON.parse(await readFile(join(workingDir, '.data', 'achilles-cli', 'settings.json'), 'utf8')), 'disabledSkills'), false);
});

test('malformed settings fall back without destroying the file', async () => {
    const workingDir = await mkdtemp(join(tmpdir(), 'achilles-settings-invalid-'));
    const settingsDir = join(workingDir, '.data', 'achilles-cli');
    await mkdir(settingsDir, { recursive: true });
    await writeFile(join(settingsDir, 'settings.json'), '{invalid');

    assert.equal(getSelectedModel(workingDir), null);
    assert.equal(getPermissionMode(workingDir), 'ask-for-approval');
    assert.equal(await readFile(join(settingsDir, 'settings.json'), 'utf8'), '{invalid');
});

test('permission mode is stored per workspace beside the selected model', async () => {
    const firstWorkspace = await mkdtemp(join(tmpdir(), 'achilles-permissions-first-'));
    const secondWorkspace = await mkdtemp(join(tmpdir(), 'achilles-permissions-second-'));

    setSelectedModel(firstWorkspace, 'anthropic/claude-sonnet');
    assert.equal(setPermissionMode(firstWorkspace, 'full-access'), 'full-access');
    assert.equal(getPermissionMode(firstWorkspace), 'full-access');
    assert.equal(getPermissionMode(secondWorkspace), 'ask-for-approval');

    const stored = JSON.parse(await readFile(join(firstWorkspace, '.data', 'achilles-cli', 'settings.json'), 'utf8'));
    assert.deepEqual(stored, {
        model: 'anthropic/claude-sonnet',
        permissions: 'full-access',
    });

    clearSelectedModel(firstWorkspace);
    assert.equal(getPermissionMode(firstWorkspace), 'full-access');
});

test('current conversation session is stored beside model and permissions', async () => {
    const workingDir = await mkdtemp(join(tmpdir(), 'achilles-current-session-'));
    const sessionId = '123e4567-e89b-42d3-a456-426614174000';
    setSelectedModel(workingDir, 'anthropic/claude-sonnet');
    setPermissionMode(workingDir, 'full-access');
    setCurrentSessionId(workingDir, sessionId);

    assert.equal(getCurrentSessionId(workingDir), sessionId);
    assert.deepEqual(JSON.parse(await readFile(join(workingDir, '.data', 'achilles-cli', 'settings.json'), 'utf8')), {
        model: 'anthropic/claude-sonnet',
        permissions: 'full-access',
        currentSessionId: sessionId,
    });
});

test('invalid persisted permission modes fall back safely and invalid writes are rejected', async () => {
    const workingDir = await mkdtemp(join(tmpdir(), 'achilles-permissions-invalid-'));
    const settingsDir = join(workingDir, '.data', 'achilles-cli');
    await mkdir(settingsDir, { recursive: true });
    await writeFile(join(settingsDir, 'settings.json'), JSON.stringify({
        version: 1,
        permissions: 'unrestricted',
    }));

    assert.equal(getPermissionMode(workingDir), 'ask-for-approval');
    assert.throws(() => setPermissionMode(workingDir, 'unrestricted'), /ask-for-approval/);
});

test('a settings write removes the legacy version property', async () => {
    const workingDir = await mkdtemp(join(tmpdir(), 'achilles-settings-legacy-version-'));
    const settingsDir = join(workingDir, '.data', 'achilles-cli');
    await mkdir(settingsDir, { recursive: true });
    await writeFile(join(settingsDir, 'settings.json'), JSON.stringify({
        version: 1,
        permissions: 'full-access',
    }));

    assert.equal(getPermissionMode(workingDir), 'full-access');
    setSelectedModel(workingDir, 'anthropic/claude-sonnet');

    const stored = JSON.parse(await readFile(join(settingsDir, 'settings.json'), 'utf8'));
    assert.deepEqual(stored, {
        permissions: 'full-access',
        model: 'anthropic/claude-sonnet',
    });
});
