import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const routerPath = new URL('../src/skills/copilot-router/oskill.md', import.meta.url);

test('Copilot router permits and prioritizes fixed coding-agent launchers', async () => {
    const descriptor = await fs.readFile(routerPath, 'utf8');
    for (const [provider, launcher] of [
        ['codexAgent', 'launch-codex'],
        ['opencodeAgent', 'launch-opencode'],
        ['piAgent', 'launch-pi'],
    ]) {
        assert.match(descriptor, new RegExp(`explicitly asks[\\s\\S]*${provider}[\\s\\S]*${launcher}`));
        assert.match(descriptor, new RegExp(`## Allowed-Skills[\\s\\S]*- ${launcher}`));
    }
});
