import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveCodexBinary } from '../scripts/codex-runner.mjs';

const agentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installScript = path.join(agentDir, 'scripts', 'install-codex.sh');
const manifestPath = path.join(agentDir, 'manifest.json');

async function writeFakeNpmCli(tempDir) {
    const npmCliPath = path.join(tempDir, 'npm-cli.cjs');
    await fs.writeFile(npmCliPath, `const fs = require('node:fs');
const path = require('node:path');
if (process.env.FAKE_NPM_ARGS_PATH) {
    fs.appendFileSync(process.env.FAKE_NPM_ARGS_PATH, JSON.stringify(process.argv.slice(2)) + '\\n');
}
if (process.argv[2] === 'view') {
    process.stdout.write(JSON.stringify(process.env.FAKE_PACKAGE_INTEGRITY || ''));
    process.exit(0);
}
const prefixIndex = process.argv.indexOf('--prefix');
if (prefixIndex < 0 || !process.argv[prefixIndex + 1]) process.exit(2);
const entry = path.join(process.argv[prefixIndex + 1], process.env.FAKE_PACKAGE_ENTRY);
fs.mkdirSync(path.dirname(entry), { recursive: true });
fs.writeFileSync(entry, '');
const packageRoot = path.join(process.argv[prefixIndex + 1], 'lib/node_modules/@openai/codex');
fs.mkdirSync(packageRoot, { recursive: true });
fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({
    name: '@openai/codex',
    version: process.env.FAKE_PACKAGE_VERSION || '0.146.0',
}));
`);
    return npmCliPath;
}

test('Codex installs its executable under the persistent agent HOME', async (t) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-install-test-'));
    t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
    const homeDir = path.join(tempDir, 'home');
    const npmCliPath = await writeFakeNpmCli(tempDir);
    const npmArgsPath = path.join(tempDir, 'npm-args.jsonl');

    const result = spawnSync('sh', [installScript], {
        env: {
            ...process.env,
            HOME: homeDir,
            NPM_CLI: npmCliPath,
            FAKE_NPM_ARGS_PATH: npmArgsPath,
            FAKE_PACKAGE_ENTRY: 'lib/node_modules/@openai/codex/bin/codex.js',
            FAKE_PACKAGE_INTEGRITY: 'sha512-yG3sPWNda/2YAIQIDq9MrrjoCTIQ7rxYM5IasrG3VBcuhCLTkgeg/JzqmJq1V98RE4MJ5jCxDXXQlOjrditFRw==',
        },
        encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const binaryPath = path.join(homeDir, '.local', 'bin', 'codex');
    assert.equal(resolveCodexBinary({ HOME: homeDir }), binaryPath);
    const launcher = await fs.readFile(binaryPath, 'utf8');
    assert.match(launcher, /\$HOME\/\.local\/lib\/node_modules/);
    assert.match(launcher, /PLOINKY_TASK_BROKER_URL/);
    assert.match(launcher, /PLOINKY_TASK_BROKER_KEY/);
    assert.match(launcher, /model_provider=.*ploinky_soul/);
    assert.match(launcher, /model_providers\.ploinky_soul\.env_key=.*PLOINKY_TASK_BROKER_KEY/);
    assert.match(launcher, /model_providers\.ploinky_soul\.wire_api=.*responses/);
    assert.match(launcher, /model=.*gpt-5\.6-sol/);
    assert.doesNotMatch(launcher, /PLOINKY_AGENT_API_KEY|PLOINKY_ROUTER_URL|PLOINKY_ENV_SOURCE_/);
    assert.equal((await fs.stat(binaryPath)).mode & 0o111, 0o111);

    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.equal(manifest.cli, 'node /code/scripts/interactive-cli.mjs');

    const script = await fs.readFile(installScript, 'utf8');
    assert.match(script, /\/opt\/ploinky-node\/lib\/node_modules\/npm\/bin\/npm-cli\.js/);
    assert.match(script, /\/usr\/local\/lib\/node_modules\/npm\/bin\/npm-cli\.js/);
    assert.doesNotMatch(script, /^\s*npm install/m);
    const npmCalls = (await fs.readFile(npmArgsPath, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    assert.deepEqual(npmCalls[0], [
        'view',
        '@openai/codex@0.146.0',
        'dist.integrity',
        '--json',
    ]);
    assert.equal(npmCalls[1].at(-1), '@openai/codex@0.146.0');
    assert.match(script, /sha512-yG3sPWNda\/2YAIQIDq9MrrjoCTIQ7rxYM5IasrG3VBcuhCLTkgeg\/JzqmJq1V98RE4MJ5jCxDXXQlOjrditFRw==/u);
});

test('Codex launcher derives managed routing only from the scoped broker capability', async (t) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-launcher-test-'));
    t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
    const homeDir = path.join(tempDir, 'home');
    const npmCliPath = await writeFakeNpmCli(tempDir);
    const install = spawnSync('sh', [installScript], {
        env: {
            ...process.env,
            HOME: homeDir,
            NPM_CLI: npmCliPath,
            FAKE_PACKAGE_ENTRY: 'lib/node_modules/@openai/codex/bin/codex.js',
            FAKE_PACKAGE_INTEGRITY: 'sha512-yG3sPWNda/2YAIQIDq9MrrjoCTIQ7rxYM5IasrG3VBcuhCLTkgeg/JzqmJq1V98RE4MJ5jCxDXXQlOjrditFRw==',
        },
        encoding: 'utf8',
    });
    assert.equal(install.status, 0, install.stderr);

    const fakeBin = path.join(tempDir, 'bin');
    const argsPath = path.join(tempDir, 'args.txt');
    await fs.mkdir(fakeBin);
    await fs.writeFile(path.join(fakeBin, 'node'), `#!/bin/sh
printf '%s\n' "$@" > "$CODEX_ARGS_PATH"
`, { mode: 0o755 });
    const launcher = path.join(homeDir, '.local', 'bin', 'codex');
    const scoped = spawnSync(launcher, ['exec', '--json', 'task'], {
        env: {
            HOME: homeDir,
            PATH: `${fakeBin}:/usr/bin:/bin`,
            CODEX_ARGS_PATH: argsPath,
            PLOINKY_TASK_BROKER_URL: 'http://127.0.0.1:43210/v1',
            PLOINKY_TASK_BROKER_KEY: 'private-task-token',
            PLOINKY_AGENT_API_KEY: 'must-not-be-used',
            PLOINKY_ROUTER_URL: 'http://must-not-be-used',
        },
        encoding: 'utf8',
    });
    assert.equal(scoped.status, 0, scoped.stderr);
    const args = await fs.readFile(argsPath, 'utf8');
    assert.match(args, /model_providers\.ploinky_soul\.base_url="http:\/\/127\.0\.0\.1:43210\/v1"/);
    assert.match(args, /model_providers\.ploinky_soul\.env_key="PLOINKY_TASK_BROKER_KEY"/);
    assert.match(args, /model_providers\.ploinky_soul\.wire_api="responses"/);
    assert.doesNotMatch(args, /private-task-token|must-not-be-used/);

    const partial = spawnSync(launcher, ['exec', 'task'], {
        env: {
            HOME: homeDir,
            PATH: `${fakeBin}:/usr/bin:/bin`,
            CODEX_ARGS_PATH: argsPath,
            PLOINKY_TASK_BROKER_URL: 'http://127.0.0.1:43210/v1',
        },
        encoding: 'utf8',
    });
    assert.equal(partial.status, 1);
    assert.match(partial.stderr, /scoped task broker capability is incomplete/);
});

test('Codex install fails closed when registry integrity differs from the pinned artifact', async (t) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-integrity-test-'));
    t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
    const homeDir = path.join(tempDir, 'home');
    const npmCliPath = await writeFakeNpmCli(tempDir);
    const result = spawnSync('sh', [installScript], {
        env: {
            ...process.env,
            HOME: homeDir,
            NPM_CLI: npmCliPath,
            FAKE_PACKAGE_ENTRY: 'lib/node_modules/@openai/codex/bin/codex.js',
            FAKE_PACKAGE_INTEGRITY: 'sha512-wrong-artifact',
        },
        encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /registry integrity does not match the pinned artifact/u);
    await assert.rejects(fs.stat(path.join(homeDir, '.local', 'bin', 'codex')), { code: 'ENOENT' });
});

test('Codex install fails closed when installed package metadata differs from the pin', async (t) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-version-test-'));
    t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
    const homeDir = path.join(tempDir, 'home');
    const result = spawnSync('sh', [installScript], {
        env: {
            ...process.env,
            HOME: homeDir,
            NPM_CLI: await writeFakeNpmCli(tempDir),
            FAKE_PACKAGE_ENTRY: 'lib/node_modules/@openai/codex/bin/codex.js',
            FAKE_PACKAGE_INTEGRITY: 'sha512-yG3sPWNda/2YAIQIDq9MrrjoCTIQ7rxYM5IasrG3VBcuhCLTkgeg/JzqmJq1V98RE4MJ5jCxDXXQlOjrditFRw==',
            FAKE_PACKAGE_VERSION: '9.9.9',
        },
        encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /installed package metadata does not match the pinned version/u);
    await assert.rejects(fs.stat(path.join(homeDir, '.local', 'bin', 'codex')), { code: 'ENOENT' });
});
