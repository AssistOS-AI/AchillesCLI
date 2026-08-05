import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const agentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installScript = path.join(agentDir, 'scripts', 'install-pi.sh');
const ensureScript = path.join(agentDir, 'scripts', 'ensure-bubblewrap.sh');
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

async function materializeInstallFixture(tempDir) {
    const fixtureAgentDir = path.join(tempDir, 'agent');
    const fixtureScriptsDir = path.join(fixtureAgentDir, 'scripts');
    const fixtureImageDir = path.join(tempDir, 'image');
    const bwrapPath = path.join(fixtureImageDir, 'usr', 'bin', 'bwrap');
    const helperPath = path.join(fixtureImageDir, 'usr', 'local', 'libexec', 'ploinky-bwrap-launch');
    await fs.mkdir(fixtureScriptsDir, { recursive: true });
    await fs.mkdir(path.dirname(bwrapPath), { recursive: true });
    await fs.mkdir(path.dirname(helperPath), { recursive: true });
    await fs.copyFile(installScript, path.join(fixtureScriptsDir, 'install-pi.sh'));
    await fs.writeFile(bwrapPath, `#!/bin/sh
cat <<'EOF'
--bind-fd FD DEST
--ro-bind-fd FD DEST
--ro-bind-data FD DEST
--perms OCTAL
EOF
`, { mode: 0o755 });
    await fs.writeFile(helperPath, `#!/bin/sh
printf '%s\n' 'ploinky-bwrap-launch-v1 source-sha=${'a'.repeat(40)} protocol=1 descriptor-fd=3 path-resolution=openat2-beneath-no-magiclinks-no-symlinks bwrap-fd-options=bind-fd,ro-bind-fd,ro-bind-data,perms typed-fs=dir,tmpfs,proc,dev,system-symlink,ro-data-path-file ro-data-path-hardening=sealed-memfd-ro-bind-data preexec-barrier=R/G credential-bound=4096'
`, { mode: 0o755 });
    const ensureSource = (await fs.readFile(ensureScript, 'utf8'))
        .replaceAll('/usr/bin/bwrap', bwrapPath)
        .replaceAll('/usr/local/libexec/ploinky-bwrap-launch', helperPath);
    await fs.writeFile(
        path.join(fixtureScriptsDir, 'ensure-bubblewrap.sh'),
        ensureSource,
        { mode: 0o755 },
    );
    return path.join(fixtureScriptsDir, 'install-pi.sh');
}

test('PI installs its executable under the persistent agent HOME', async (t) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-install-test-'));
    t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
    const homeDir = path.join(tempDir, 'home');
    const fakeBinDir = path.join(tempDir, 'bin');
    const npmCliPath = await writeFakeNpmCli(tempDir);
    await fs.mkdir(fakeBinDir, { recursive: true });
    const fixtureInstallScript = await materializeInstallFixture(tempDir);

    const result = spawnSync('sh', [fixtureInstallScript], {
        env: {
            ...process.env,
            HOME: homeDir,
            PATH: `${fakeBinDir}:${process.env.PATH}`,
            NPM_CLI: npmCliPath,
            FAKE_PACKAGE_ENTRY: 'lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
        },
        encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const binaryPath = path.join(homeDir, '.local', 'bin', 'pi');
    assert.match(await fs.readFile(binaryPath, 'utf8'), /\$HOME\/\.local\/lib\/node_modules/);
    assert.equal((await fs.stat(binaryPath)).mode & 0o111, 0o111);

    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.equal(manifest.cli, '"$HOME/.local/bin/pi"');
    assert.equal(manifest.containerSecurity, undefined);
    assert.equal(manifest.health?.readiness?.script, 'readiness.sh');
    assert.equal(manifest.env.includes('PLOINKY_WORKSPACE_ROOT'), false);

    const script = await fs.readFile(installScript, 'utf8');
    assert.match(script, /\/opt\/ploinky-node\/lib\/node_modules\/npm\/bin\/npm-cli\.js/);
    assert.match(script, /\/usr\/local\/lib\/node_modules\/npm\/bin\/npm-cli\.js/);
    assert.doesNotMatch(script, /^\s*npm install/m);
});
