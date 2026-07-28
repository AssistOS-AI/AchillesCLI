import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getPermissionMode } from '../src/lib/achillesSettings.mjs';
import { setPersistedBrokerPermissionMode } from '../src/permissions/PersistedPermissionMode.mjs';

function createPermissionClient(initialMode = 'ask-for-approval') {
    let currentMode = initialMode;
    const writes = [];
    return {
        writes,
        async getMode() {
            return { mode: currentMode };
        },
        async setMode(mode) {
            writes.push(mode);
            currentMode = mode;
            return { mode: currentMode };
        },
    };
}

test('/permissions persists the mode only after the Broker confirms it', async () => {
    const workingDir = await mkdtemp(join(tmpdir(), 'achilles-permission-command-'));
    const permissionControlClient = createPermissionClient();

    const result = await setPersistedBrokerPermissionMode({
        permissionControlClient,
        workingDir,
        mode: 'full-access',
    });

    assert.equal(result, 'full-access');
    assert.deepEqual(permissionControlClient.writes, ['full-access']);
    assert.equal(getPermissionMode(workingDir), 'full-access');
});

test('/permissions restores the previous Broker mode when settings persistence fails', async () => {
    const invalidWorkingDir = join(
        await mkdtemp(join(tmpdir(), 'achilles-permission-write-failure-')),
        'not-a-directory',
    );
    await writeFile(invalidWorkingDir, 'file');
    const permissionControlClient = createPermissionClient();

    await assert.rejects(
        setPersistedBrokerPermissionMode({
            permissionControlClient,
            workingDir: invalidWorkingDir,
            mode: 'full-access',
        }),
        /ENOTDIR/,
    );
    assert.deepEqual(permissionControlClient.writes, [
        'full-access',
        'ask-for-approval',
    ]);
});
