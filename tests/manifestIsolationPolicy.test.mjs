import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const ignoredDirectories = new Set([
    '.achilles-cli',
    '.git',
    '.ploinky',
    '__pycache__',
    'node_modules',
]);

async function findManifests(directory = repoRoot) {
    const manifests = [];
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!ignoredDirectories.has(entry.name)) {
                manifests.push(...await findManifests(path.join(directory, entry.name)));
            }
        } else if (entry.isFile() && entry.name === 'manifest.json') {
            manifests.push(path.join(directory, entry.name));
        }
    }
    return manifests;
}

async function readManifest(relativePath) {
    return JSON.parse(await fs.readFile(path.join(repoRoot, relativePath), 'utf8'));
}

function isUsableContainerDeclaration(value) {
    return typeof value === 'string'
        && value.length > 0
        && value === value.trim()
        && !/[\s\0]/.test(value);
}

function assertSelectorContract(manifest, manifestPath) {
    if (Object.hasOwn(manifest, 'lite-sandbox')) {
        assert.equal(
            typeof manifest['lite-sandbox'],
            'boolean',
            `${manifestPath}: lite-sandbox must be boolean when declared`,
        );
    }

    if (manifest['lite-sandbox'] === true) {
        assert.equal(
            Object.hasOwn(manifest, 'network'),
            false,
            `${manifestPath}: sandbox networking is platform-owned`,
        );
        return;
    }

    assert.equal(
        isUsableContainerDeclaration(manifest.container),
        true,
        `${manifestPath}: false/missing lite-sandbox requires a usable container declaration`,
    );
}

test('agent manifests satisfy the capability-based selector contract', async () => {
    for (const manifestPath of await findManifests()) {
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
        assertSelectorContract(manifest, path.relative(repoRoot, manifestPath));
    }
});

test('sandbox selector validation is agent-name and interactivity independent', () => {
    assert.doesNotThrow(() => assertSelectorContract({
        name: 'futureBatchWorker',
        'lite-sandbox': true,
        container: { dormant: 'sandbox mode does not inspect this declaration' },
    }, 'futureBatchWorker/manifest.json'));
});

test('container selector validation mirrors the runtime declaration grammar', () => {
    for (const container of ['node:24', 'alpine', 'registry/repository:tag']) {
        assert.doesNotThrow(() => assertSelectorContract({ container }, `valid:${container}`));
    }

    for (const container of [
        undefined,
        '',
        '   ',
        ' node:24',
        'node:24 ',
        'node:\t24',
        'node:\n24',
        `node:${String.fromCharCode(0)}24`,
        false,
        {},
    ]) {
        assert.throws(
            () => assertSelectorContract({ container }, 'malformed-container'),
            /requires a usable container declaration/,
        );
        assert.throws(
            () => assertSelectorContract({ container, 'lite-sandbox': false }, 'malformed-container'),
            /requires a usable container declaration/,
        );
        assert.doesNotThrow(
            () => assertSelectorContract({ container, 'lite-sandbox': true }, 'dormant-container'),
        );
    }
});

test('required coding agents retain selector-only dual-mode declarations', async () => {
    for (const agent of ['codexAgent', 'opencodeAgent', 'piAgent']) {
        const manifestPath = `${agent}/manifest.json`;
        const manifest = await readManifest(manifestPath);

        assert.equal(manifest['lite-sandbox'], true, manifestPath);
        assert.equal(manifest.startup, 'manual', manifestPath);
        assert.equal(
            manifest.container,
            'docker.io/assistos/ploinky-node:24-bookworm-tools',
            manifestPath,
        );
        assert.equal(Object.hasOwn(manifest, 'network'), false, manifestPath);
        assert.deepEqual(
            manifest.containerSecurity,
            { nestedBwrap: true },
            `${manifestPath}: container mode must admit the inner provider bwrap without privilege`,
        );

        assertSelectorContract({ ...manifest, 'lite-sandbox': true }, `${manifestPath}:sandbox`);
        assertSelectorContract({ ...manifest, 'lite-sandbox': false }, `${manifestPath}:container`);
        assertSelectorContract(
            Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== 'lite-sandbox')),
            `${manifestPath}:container-default`,
        );
    }
});

test('coding interactive task identities use ownership-safe segments', async () => {
    for (const agent of ['codexAgent', 'opencodeAgent', 'piAgent']) {
        const source = await fs.readFile(path.join(repoRoot, agent, 'scripts/interactive-cli.mjs'), 'utf8');
        assert.match(source, /taskId: `interactive-\$\{dependencies\.randomUUID\(\)\}`/);
        assert.doesNotMatch(source, /taskId: `interactive:/);
    }
});

test('GPTResearcher remains a manual specialized container', async () => {
    const manifest = await readManifest('GPTResearcher/manifest.json');
    assert.equal(Object.hasOwn(manifest, 'lite-sandbox'), false);
    assert.equal(manifest.container, 'docker.io/assistos/bwrap-runner:node24-python-bookworm');
    assert.equal(manifest.startup, 'manual');
    assert.equal(manifest.agent, 'sh /code/scripts/start-gpt-researcher.sh');
    assert.equal(manifest.profiles?.default?.install, 'sh /code/scripts/install-gpt-researcher.sh');
    assert.equal(manifest.readiness?.protocol, 'mcp');
    assert.equal(manifest.health?.readiness?.script, 'readiness.sh');
});
