import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolvePiBinary } from '../scripts/execute-task.mjs';

const agentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installScript = path.join(agentDir, 'scripts', 'install-pi.sh');
const manifestPath = path.join(agentDir, 'manifest.json');

async function writeFakeNpmCli(tempDir) {
    const npmCliPath = path.join(tempDir, 'npm-cli.cjs');
    await fs.writeFile(npmCliPath, `const fs = require('node:fs');
const path = require('node:path');
const prefixIndex = process.argv.indexOf('--prefix');
if (prefixIndex < 0 || !process.argv[prefixIndex + 1]) process.exit(2);
const entry = path.join(process.argv[prefixIndex + 1], process.env.FAKE_PACKAGE_ENTRY);
fs.mkdirSync(path.dirname(entry), { recursive: true });
fs.writeFileSync(entry, '');
`);
    return npmCliPath;
}

test('PI installs its executable under the persistent agent HOME', async (t) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-install-test-'));
    t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
    const homeDir = path.join(tempDir, 'home');
    const npmCliPath = await writeFakeNpmCli(tempDir);

    const result = spawnSync('sh', [installScript], {
        env: {
            ...process.env,
            HOME: homeDir,
            NPM_CLI: npmCliPath,
            FAKE_PACKAGE_ENTRY: 'lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
        },
        encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const binaryPath = path.join(homeDir, '.local', 'bin', 'pi');
    assert.equal(resolvePiBinary({ HOME: homeDir }), binaryPath);
    assert.match(await fs.readFile(binaryPath, 'utf8'), /\$HOME\/\.local\/lib\/node_modules/);
    assert.equal((await fs.stat(binaryPath)).mode & 0o111, 0o111);

    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.equal(manifest.cli, '"$HOME/.local/bin/pi"');

    const script = await fs.readFile(installScript, 'utf8');
    assert.match(script, /\/opt\/ploinky-node\/lib\/node_modules\/npm\/bin\/npm-cli\.js/);
    assert.match(script, /\/usr\/local\/lib\/node_modules\/npm\/bin\/npm-cli\.js/);
    assert.doesNotMatch(script, /^\s*npm install/m);
});
