import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const manifestUrl = new URL('../manifest.json', import.meta.url);

test('GPTResearcher uses one explicit authenticated Router target and a pinned image', async () => {
    const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
    assert.match(manifest.container, /@sha256:[0-9a-f]{64}$/);
    assert.deepEqual(manifest.httpServices, [{
        slug: 'gpt-researcher',
        externalPrefix: '/services/gpt-researcher/',
        internalPrefix: '/services/gpt-researcher/',
        port: 8000,
        access: 'authenticated',
    }]);
    assert.equal(Object.hasOwn(manifest.profiles.default, ['additional', 'Server', 'Port'].join('')), false);
    assert.equal(Object.hasOwn(manifest.profiles.default, 'openPorts'), false);
});

test('GPTResearcher install is pinned and rejects mismatched pre-v5 state', async () => {
    const installer = await readFile(new URL('../scripts/install-gpt-researcher.sh', import.meta.url), 'utf8');
    assert.match(installer, /SOURCE_COMMIT=5cdad9cb434754188b78bd998df18dd8d502cf7e/);
    assert.match(installer, /LOCK_SHA256=[0-9a-f]{64}/);
    assert.match(installer, /BOOTSTRAP_LOCK_SHA256=[0-9a-f]{64}/);
    assert.match(installer, /--require-hashes/);
    assert.match(installer, /--only-binary=:all:/);
    assert.match(installer, /--no-build-isolation/);
    assert.match(installer, /--no-binary=docopt,langdetect,sgmllib3k/);
    assert.match(installer, /-B -m pip --isolated check/);
    assert.match(installer, /export GIT_OPTIONAL_LOCKS=0/);
    assert.match(installer, /sys\.dont_write_bytecode = True/);
    assert.match(installer, /bin\/python" -I -S -/);
    assert.match(installer, /bin\/python" -I -B -m pip/);
    assert.match(installer, /unowned installed file/);
    assert.match(installer, /Recreate the agent|recreate the agent/i);
    assert.doesNotMatch(installer, /rm -rf/);
    assert.doesNotMatch(installer, /git clone --depth 1/);
    assert.doesNotMatch(installer, /pip install[^\n]*-r "\$APP_DIR\/requirements\.txt"/);
});

test('GPTResearcher ASGI adapter accepts only its service base path', async () => {
    const adapter = await readFile(new URL('../scripts/gpt_researcher_base_path.py', import.meta.url), 'utf8');
    const readiness = await readFile(new URL('../readiness.sh', import.meta.url), 'utf8');
    assert.match(adapter, /BASE_PATH = "\/services\/gpt-researcher"/);
    assert.match(adapter, /route outside service base path/);
    assert.match(adapter, /child_scope\["root_path"\] = BASE_PATH/);
    assert.match(readiness, /127\.0\.0\.1:8000\/services\/gpt-researcher\//);
    assert.doesNotMatch(readiness, /127\.0\.0\.1:8000\/",/);
});

test('GPTResearcher ASGI adapter streams SSE and split base-path rewrites', () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const result = spawnSync('python3', ['-m', 'unittest', 'test_base_path_adapter.py'], {
        cwd: testDir,
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
