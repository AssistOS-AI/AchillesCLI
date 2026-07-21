import assert from 'node:assert/strict';
import test from 'node:test';

import { SlashCommandHandler } from '../src/repl/SlashCommandHandler.mjs';

function createHandler() {
    let mode = 'ask-for-approval';
    return new SlashCommandHandler({
        executeSkill: async () => null,
        getUserSkills: () => [],
        getSkills: () => [],
        getPermissions: async () => mode,
        setPermissions: async (next) => {
            mode = next;
            return mode;
        },
    });
}

test('/permissions shows and changes the workspace Bash permission mode', async () => {
    const handler = createHandler();
    const current = await handler.executeSlashCommand('permissions', '');
    assert.equal(current.result, 'Bash permissions: ask-for-approval');

    const changed = await handler.executeSlashCommand('permissions', 'full-access');
    assert.equal(changed.result, 'Bash permissions set to full-access.');

    const after = await handler.executeSlashCommand('permissions', '');
    assert.equal(after.result, 'Bash permissions: full-access');
});

test('/permissions rejects unknown modes', async () => {
    const handler = createHandler();
    const result = await handler.executeSlashCommand('permissions', 'unsafe');
    assert.match(result.error, /ask-for-approval\|full-access/);
});
