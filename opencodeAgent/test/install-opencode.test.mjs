import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveOpenCodeBin } from '../scripts/opencode-runner.mjs';

const agentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installScript = path.join(agentDir, 'scripts', 'install-opencode.sh');
const ensureScript = path.join(agentDir, 'scripts', 'ensure-bubblewrap.sh');
const configTemplate = path.join(agentDir, 'opencode.json');
const manifestPath = path.join(agentDir, 'manifest.json');

async function writeFakeCurl(binDir) {
    const curlPath = path.join(binDir, 'curl');
    await fs.writeFile(curlPath, `#!/bin/sh
cat <<'INSTALLER'
#!/bin/sh
set -eu
mkdir -p "$HOME/.opencode/bin"
printf '%s\n' '#!/bin/sh' 'exit 0' > "$HOME/.opencode/bin/opencode"
chmod 755 "$HOME/.opencode/bin/opencode"
INSTALLER
`, { mode: 0o755 });
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
    await fs.copyFile(installScript, path.join(fixtureScriptsDir, 'install-opencode.sh'));
    await fs.copyFile(configTemplate, path.join(fixtureAgentDir, 'opencode.json'));
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
    return path.join(fixtureScriptsDir, 'install-opencode.sh');
}

test('installer writes the managed Soul Gateway config without changing provider state', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-install-test-'));
    const homeDir = path.join(tempDir, 'home');
    const fakeBinDir = path.join(tempDir, 'bin');
    const configDir = path.join(homeDir, '.config', 'opencode');
    const authPath = path.join(homeDir, '.local', 'share', 'opencode', 'auth.json');
    const modelPath = path.join(homeDir, '.local', 'state', 'opencode', 'model.json');

    await fs.mkdir(fakeBinDir, { recursive: true });
    await fs.mkdir(configDir, { recursive: true });
    await fs.mkdir(path.dirname(authPath), { recursive: true });
    await fs.mkdir(path.dirname(modelPath), { recursive: true });
    await writeFakeCurl(fakeBinDir);
    await fs.writeFile(path.join(configDir, 'opencode.json'), '{"old":true}\n');
    await fs.writeFile(authPath, '{"credential":"keep"}\n');
    await fs.writeFile(modelPath, '{"recent":[{"providerID":"openai","modelID":"existing"}]}\n');
    const fixtureInstallScript = await materializeInstallFixture(tempDir);

    const result = spawnSync('sh', [fixtureInstallScript], {
        env: {
            ...process.env,
            HOME: homeDir,
            PATH: `${fakeBinDir}:${process.env.PATH}`,
        },
        encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /configured Soul Gateway/);
    assert.equal(
        await fs.readFile(path.join(configDir, 'opencode.json'), 'utf8'),
        await fs.readFile(configTemplate, 'utf8'),
    );
    assert.equal((await fs.stat(configDir)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(configDir, 'opencode.json'))).mode & 0o777, 0o600);
    assert.equal(await fs.readFile(authPath, 'utf8'), '{"credential":"keep"}\n');
    assert.match(await fs.readFile(modelPath, 'utf8'), /"modelID":"existing"/);
    assert.equal(resolveOpenCodeBin({ HOME: homeDir }), path.join(homeDir, '.opencode', 'bin', 'opencode'));
    assert.equal(resolveOpenCodeBin({}), '/home/agent/.opencode/bin/opencode');
});

test('installer leaves the persistent config untouched when OpenCode download fails', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-install-failure-test-'));
    const homeDir = path.join(tempDir, 'home');
    const fakeBinDir = path.join(tempDir, 'bin');
    const configDir = path.join(homeDir, '.config', 'opencode');
    const configPath = path.join(configDir, 'opencode.json');

    await fs.mkdir(fakeBinDir, { recursive: true });
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(fakeBinDir, 'curl'), '#!/bin/sh\nexit 22\n', { mode: 0o755 });
    await fs.writeFile(configPath, '{"existing":true}\n');
    const fixtureInstallScript = await materializeInstallFixture(tempDir);

    const result = spawnSync('sh', [fixtureInstallScript], {
        env: {
            ...process.env,
            HOME: homeDir,
            PATH: `${fakeBinDir}:${process.env.PATH}`,
        },
        encoding: 'utf8',
    });

    assert.equal(result.status, 22);
    assert.equal(await fs.readFile(configPath, 'utf8'), '{"existing":true}\n');
});

test('config uses only the task-scoped Soul broker credential', async () => {
    const config = JSON.parse(await fs.readFile(configTemplate, 'utf8'));
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));

    assert.equal(config.model, undefined);
    assert.equal(config.small_model, undefined);
    assert.equal(config.enabled_providers, undefined);
    assert.deepEqual(config.permission, {
        '*': 'allow',
        external_directory: 'deny',
    });
    assert.equal(config.provider?.soul?.npm, '@ai-sdk/openai-compatible');
    assert.equal(config.provider?.soul?.options?.baseURL, '{env:PLOINKY_TASK_BROKER_URL}');
    assert.equal(config.provider?.soul?.options?.apiKey, '{env:PLOINKY_TASK_BROKER_KEY}');
    assert.deepEqual(Object.keys(config.provider?.soul?.models || {}), ['fast', 'plan', 'deep']);
    assert.ok(!JSON.stringify(config).includes('PLOINKY_ROUTER_URL'));
    assert.ok(!JSON.stringify(config).includes('PLOINKY_AGENT_API_KEY'));
    assert.equal(manifest.profiles.default.install, 'sh /code/scripts/install-opencode.sh');
    assert.equal(manifest.cli, '"$HOME/.opencode/bin/opencode"');
    assert.equal(manifest.env.includes('PLOINKY_WORKSPACE_ROOT'), false);
    assert.equal(manifest.containerSecurity, undefined);
    assert.equal(manifest.health?.readiness?.script, 'readiness.sh');
    assert.ok(!JSON.stringify(manifest).includes('PLOINKY_AGENT_API_KEY'));
    assert.doesNotMatch(
        JSON.stringify(manifest),
        /SOUL_GATEWAY_(?:API_KEY|BASE_URL)|PLOINKY_ROUTER_(?:URL|HOST|PORT)/,
    );
});
