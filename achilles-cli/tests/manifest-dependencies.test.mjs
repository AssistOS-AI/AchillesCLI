import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TEST_DIR, '..');

test('AchillesCLI starts Soul Gateway before model discovery', async () => {
    const manifest = JSON.parse(await readFile(join(REPO_ROOT, 'manifest.json'), 'utf8'));

    assert.ok(Array.isArray(manifest.enable));
    assert.ok(manifest.enable.includes('proxies/soul-gateway'));
});

test('AchillesCLI leaves optional coding and research agents for explicit startup', async () => {
    const manifest = JSON.parse(await readFile(join(REPO_ROOT, 'manifest.json'), 'utf8'));

    assert.ok(Array.isArray(manifest.enable));
    for (const agentName of ['GPTResearcher', 'searchAgent', 'opencodeAgent', 'piAgent', 'codexAgent']) {
        assert.ok(!manifest.enable.some((entry) => String(entry).includes(agentName)));
    }
});

test('AchillesCLI optional workers declare manual workspace startup', async () => {
    for (const agentName of ['GPTResearcher', 'opencodeAgent', 'piAgent', 'codexAgent']) {
        const manifest = JSON.parse(await readFile(join(REPO_ROOT, '..', agentName, 'manifest.json'), 'utf8'));
        assert.equal(manifest.startup, 'manual', `${agentName} should start only through explicit invocation`);
    }
});
