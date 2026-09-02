import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const installer = fileURLToPath(new URL('../scripts/install-gpt-researcher.sh', import.meta.url));

function run(command, args, options = {}) {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60_000, ...options });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${command} failed: ${result.stdout}\n${result.stderr}`);
    return result;
}

test('installer replaces a stale PyPI distribution with the UI checkout through real offline pip', { timeout: 120_000 }, t => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'gpt-source-install-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const fixture = path.join(root, 'upstream fixture');
    const wheels = path.join(root, 'wheels');
    const tools = path.join(root, 'tools');
    const home = path.join(root, 'agent home');
    const app = path.join(home, 'gpt-researcher', 'app');
    const venv = path.join(home, 'gpt-researcher', 'venv');
    for (const dir of [fixture, wheels, tools, path.join(fixture, 'gpt_researcher')]) mkdirSync(dir, { recursive: true });

    // A self-contained PEP 517 backend keeps this regression entirely offline.
    // Actual venv, pip build/install/uninstall, and Python imports still run.
    const backend = `from pathlib import Path
import zipfile

def wheel(output, name, version, source):
    stem = name.replace('-', '_')
    filename = f'{stem}-{version}-py3-none-any.whl'
    info = f'{stem}-{version}.dist-info'
    with zipfile.ZipFile(Path(output) / filename, 'w') as archive:
        archive.writestr(f'{stem}/__init__.py', source)
        archive.writestr(f'{info}/METADATA', f'Metadata-Version: 2.1\\nName: {name}\\nVersion: {version}\\n')
        archive.writestr(f'{info}/WHEEL', 'Wheel-Version: 1.0\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n')
        archive.writestr(f'{info}/RECORD', '')
    return filename

def build_wheel(wheel_directory, config_settings=None, metadata_directory=None):
    source = (Path(__file__).parent / 'gpt_researcher' / '__init__.py').read_text()
    return wheel(wheel_directory, 'gpt-researcher', '0.14.7', source)
`;
    writeFileSync(path.join(fixture, 'fixture_backend.py'), backend);
    writeFileSync(path.join(fixture, 'pyproject.toml'), '[build-system]\nrequires = []\nbuild-backend = "fixture_backend"\nbackend-path = ["."]\n');
    writeFileSync(path.join(fixture, 'requirements.txt'), '# Fixture has no external requirements.\n');
    writeFileSync(path.join(fixture, 'gpt_researcher', '__init__.py'), 'ORIGIN = "selected-default-checkout"\nclass GPTResearcher: pass\n');
    const env = {
        ...process.env, HOME: home, WORKSPACE_PATH: path.join(root, 'workspace'),
        PIP_NO_INDEX: '1', PIP_FIND_LINKS: wheels, PIP_DISABLE_PIP_VERSION_CHECK: '1',
        FIXTURE_SOURCE: fixture, FIXTURE_GIT_LOG: path.join(root, 'git.json'),
    };
    run('python3', ['-c', `import sys; sys.path.insert(0, sys.argv[1]); from fixture_backend import wheel
wheel(sys.argv[2], 'gpt-researcher', '0.16.0', 'raise RuntimeError("broken independently installed release")\\n')
wheel(sys.argv[2], 'langchain-mcp-adapters', '1.0.0', '')
wheel(sys.argv[2], 'ddgs', '1.0.0', '')`, fixture, wheels], { env });
    run('python3', ['-m', 'venv', venv], { env });
    const python = path.join(venv, 'bin', 'python');
    run(python, ['-m', 'pip', 'install', 'gpt-researcher==0.16.0'], { env });
    const broken = spawnSync(python, ['-c', 'import gpt_researcher'], { env, encoding: 'utf8' });
    assert.notEqual(broken.status, 0);
    assert.match(broken.stderr, /broken independently installed release/);

    // Only the public clone is substituted; pip never sees a replacement
    // executable or implementation-specific argument expectations.
    writeFileSync(path.join(tools, 'git'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args.length !== 5 || args[0] !== 'clone' || args[1] !== '--depth' || args[2] !== '1'
    || args[3] !== 'https://github.com/assafelovic/gpt-researcher.git') process.exit(92);
fs.writeFileSync(process.env.FIXTURE_GIT_LOG, JSON.stringify(args));
fs.cpSync(process.env.FIXTURE_SOURCE, args[4], { recursive: true });
fs.mkdirSync(path.join(args[4], '.git'));
`, { mode: 0o755 });
    const installEnv = { ...env, PATH: `${tools}${path.delimiter}${process.env.PATH}` };
    run('/bin/sh', [installer], { env: installEnv });
    assert.equal(JSON.parse(readFileSync(env.FIXTURE_GIT_LOG, 'utf8'))[4], app);
    const imported = JSON.parse(run(python, ['-c', `import importlib.metadata, json, pathlib, gpt_researcher
d = importlib.metadata.distribution('gpt-researcher')
print(json.dumps({'origin': gpt_researcher.ORIGIN, 'module': gpt_researcher.__file__, 'version': d.version, 'direct': json.loads(d.read_text('direct_url.json'))}))`], { env, cwd: root }).stdout);
    assert.equal(imported.origin, 'selected-default-checkout');
    assert.equal(imported.version, '0.14.7');
    assert.ok(realpathSync(imported.module).startsWith(`${realpathSync(venv)}${path.sep}`));
    assert.equal(realpathSync(fileURLToPath(imported.direct.url)), realpathSync(app));
    for (const name of ['pyproject.toml', 'requirements.txt', 'fixture_backend.py', 'gpt_researcher/__init__.py']) {
        assert.deepEqual(readFileSync(path.join(app, name)), readFileSync(path.join(fixture, name)), `${name} must remain unchanged`);
    }
    // A repeated lifecycle install reuses the checkout and preserves settings.
    const settingsPath = path.join(home, 'gpt-researcher-settings.json');
    writeFileSync(settingsPath, '{"searchProvider":"preserved"}\n');
    writeFileSync(path.join(tools, 'git'), '#!/bin/sh\nexit 93\n', { mode: 0o755 });
    run('/bin/sh', [installer], { env: installEnv });
    assert.equal(readFileSync(settingsPath, 'utf8'), '{"searchProvider":"preserved"}\n');
    assert.equal(run(python, ['-c', 'from gpt_researcher import ORIGIN; print(ORIGIN)'], { env, cwd: root }).stdout.trim(), 'selected-default-checkout');
});
