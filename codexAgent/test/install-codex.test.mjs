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

async function writeFakeNpm(binDir) {
    const npmPath = path.join(binDir, 'npm');
    await fs.writeFile(npmPath, `#!/bin/sh
set -eu
prefix=
while [ "$#" -gt 0 ]; do
    if [ "$1" = "--prefix" ]; then
        shift
        prefix=$1
    fi
    shift
done
test -n "$prefix"
entry="$prefix/$FAKE_PACKAGE_ENTRY"
mkdir -p "$(dirname "$entry")"
: > "$entry"
`, { mode: 0o755 });
}

test('Codex installs its executable under the persistent agent HOME', async (t) => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-install-test-'));
    t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
    const homeDir = path.join(tempDir, 'home');
    const fakeBinDir = path.join(tempDir, 'bin');
    await fs.mkdir(fakeBinDir, { recursive: true });
    await writeFakeNpm(fakeBinDir);

    const result = spawnSync('sh', [installScript], {
        env: {
            ...process.env,
            HOME: homeDir,
            FAKE_PACKAGE_ENTRY: 'lib/node_modules/@openai/codex/bin/codex.js',
            PATH: `${fakeBinDir}:/usr/bin:/bin`,
        },
        encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const binaryPath = path.join(homeDir, '.local', 'bin', 'codex');
    assert.equal(resolveCodexBinary({ HOME: homeDir }), binaryPath);
    assert.match(await fs.readFile(binaryPath, 'utf8'), /\$HOME\/\.local\/lib\/node_modules/);
    assert.equal((await fs.stat(binaryPath)).mode & 0o111, 0o111);

    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.equal(manifest.cli, '"$HOME/.local/bin/codex"');
});
