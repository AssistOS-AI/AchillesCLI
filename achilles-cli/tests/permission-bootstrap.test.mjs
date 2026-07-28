import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseBrokerBootstrapOptions } from '../src/cli.mjs';
import { getPermissionMode, setPermissionMode } from '../src/lib/achillesSettings.mjs';

test('broker startup restores the permission mode for the selected workspace', async () => {
    const workingDir = await mkdtemp(join(tmpdir(), 'achilles-permission-bootstrap-'));
    setPermissionMode(workingDir, 'full-access');

    const options = parseBrokerBootstrapOptions(['--dir', workingDir]);
    assert.equal(options.workingDir, workingDir);
    assert.equal(options.permissionMode, 'full-access');
});

test('an explicit permission flag overrides the persisted workspace mode', async () => {
    const workingDir = await mkdtemp(join(tmpdir(), 'achilles-permission-override-'));
    setPermissionMode(workingDir, 'full-access');

    const options = parseBrokerBootstrapOptions([
        '--permissions',
        'ask-for-approval',
        '--dir',
        workingDir,
    ]);
    assert.equal(options.permissionMode, 'ask-for-approval');
    assert.equal(options.workingDir, workingDir);
    assert.equal(getPermissionMode(workingDir), 'full-access');
});

test('broker startup defaults missing workspace settings to ask-for-approval', async () => {
    const workingDir = await mkdtemp(join(tmpdir(), 'achilles-permission-default-'));

    const options = parseBrokerBootstrapOptions(['--dir', workingDir]);
    assert.equal(options.permissionMode, 'ask-for-approval');
});

test('broker distinguishes the interactive REPL from single-shot prompts', async () => {
    const workingDir = await mkdtemp(join(tmpdir(), 'achilles-permission-runtime-'));

    assert.equal(
        parseBrokerBootstrapOptions(['--dir', workingDir, '--ui', 'minimal']).singleShot,
        false,
    );
    assert.equal(
        parseBrokerBootstrapOptions(['--dir', workingDir, 'inspect the repo']).singleShot,
        true,
    );
});
