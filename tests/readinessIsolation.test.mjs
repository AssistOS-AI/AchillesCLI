import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const REQUIRED_BWRAP_OPTIONS = Object.freeze([
    '--bind-fd FD DEST',
    '--ro-bind-fd FD DEST',
    '--ro-bind-data FD DEST',
    '--perms OCTAL',
]);

const REQUIRED_HELPER_CAPABILITIES = Object.freeze([
    `ploinky-bwrap-launch-v2 source-sha=${'a'.repeat(40)}`,
    'protocol=2 descriptor-fd=3',
    'path-resolution=openat2-beneath-no-magiclinks-no-symlinks',
    'bwrap-fd-options=bind-fd,ro-bind-fd,ro-bind-data,perms',
    'typed-fs=dir,tmpfs,proc,dev,system-symlink,ro-data-path-file',
    'ro-data-path-hardening=sealed-memfd-ro-bind-data',
    'home-sources=sandbox-workspace-v2,container-native',
    'home-marker=ploinky-home-v2-schema-2',
    'home-revalidation=post-barrier-G',
    'preexec-barrier=R/G',
    'credential-bound=4096',
]);

const implementations = Object.freeze([
    Object.freeze({
        agent: 'OpenCode',
        source: new URL('../opencodeAgent/readiness.sh', import.meta.url),
        ensureSource: new URL('../opencodeAgent/scripts/ensure-bubblewrap.sh', import.meta.url),
        providerPaths: Object.freeze([
            '.opencode/bin/opencode',
            '.config/opencode/opencode.json',
        ]),
    }),
    Object.freeze({
        agent: 'PI',
        source: new URL('../piAgent/readiness.sh', import.meta.url),
        ensureSource: new URL('../piAgent/scripts/ensure-bubblewrap.sh', import.meta.url),
        providerPaths: Object.freeze([
            '.local/bin/pi',
            '.local/lib/node_modules/@earendil-works/pi-coding-agent',
        ]),
    }),
]);

async function writeExecutable(filePath, source) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, source, { mode: 0o755 });
}

function replaceImagePaths(source, { bwrapPath, helperPath }) {
    return source
        .replaceAll('/usr/bin/bwrap', bwrapPath)
        .replaceAll('/usr/local/libexec/ploinky-bwrap-launch', helperPath);
}

async function makeCapabilityFixture(t, implementation, {
    bwrapHelp = REQUIRED_BWRAP_OPTIONS.join('\n'),
    helperCapabilities = REQUIRED_HELPER_CAPABILITIES.join(' '),
    includeBwrap = true,
    includeHelper = true,
} = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'achilles-readiness-capability-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const bwrapPath = path.join(root, 'image', 'usr', 'bin', 'bwrap');
    const helperPath = path.join(root, 'image', 'usr', 'local', 'libexec', 'ploinky-bwrap-launch');
    const probeLog = path.join(root, 'probe.log');
    const scriptPath = path.join(root, 'ensure-bubblewrap.sh');

    if (includeBwrap) {
        await writeExecutable(bwrapPath, `#!/bin/sh
printf '%s\\n' "bwrap:$*" >> '${probeLog}'
test "\${1:-}" = '--help' || exit 64
cat <<'EOF'
${bwrapHelp}
EOF
`);
    }
    if (includeHelper) {
        await writeExecutable(helperPath, `#!/bin/sh
printf '%s\\n' "helper:$*" >> '${probeLog}'
test "\${1:-}" = '--capabilities' || exit 64
cat <<'EOF'
${helperCapabilities}
EOF
`);
    }

    const source = await fs.readFile(implementation.ensureSource, 'utf8');
    await writeExecutable(scriptPath, replaceImagePaths(source, { bwrapPath, helperPath }));
    return { probeLog, root, scriptPath };
}

async function makeReadinessFixture(t, implementation, mode) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `achilles-${mode}-readiness-`));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const home = path.join(root, mode === 'sandbox' ? 'home-agent' : 'root');
    const code = path.join(root, 'code');
    const bin = path.join(root, 'bin');
    const providerMarker = path.join(root, 'provider-executed');
    const nodeMarker = path.join(root, 'node-executed');
    const ensureMarker = path.join(root, 'capability-probed');

    await fs.mkdir(path.join(code, 'scripts'), { recursive: true });
    await fs.mkdir(bin, { recursive: true });
    for (const providerPath of implementation.providerPaths) {
        const target = path.join(home, providerPath);
        if (providerPath.endsWith('pi-coding-agent')) {
            await fs.mkdir(target, { recursive: true });
        } else if (providerPath.endsWith('.json')) {
            await fs.mkdir(path.dirname(target), { recursive: true });
            await fs.writeFile(target, '{}\n');
        } else {
            await writeExecutable(target, `#!/bin/sh
touch '${providerMarker}'
exit 91
`);
        }
    }
    await writeExecutable(path.join(bin, 'node'), `#!/bin/sh
touch '${nodeMarker}'
exit 92
`);
    await writeExecutable(path.join(code, 'scripts', 'ensure-bubblewrap.sh'), `#!/bin/sh
touch '${ensureMarker}'
exit 0
`);
    await fs.copyFile(implementation.source, path.join(code, 'readiness.sh'));
    await fs.chmod(path.join(code, 'readiness.sh'), 0o755);

    return {
        code,
        ensureMarker,
        home,
        nodeMarker,
        providerMarker,
        run() {
            return spawnSync('/bin/sh', [path.join(code, 'readiness.sh')], {
                encoding: 'utf8',
                env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` },
            });
        },
    };
}

for (const implementation of implementations) {
    test(`${implementation.agent} readiness is capability-only in sandbox and container HOME modes`, async (t) => {
        for (const mode of ['sandbox', 'container']) {
            const fixture = await makeReadinessFixture(t, implementation, mode);
            const result = fixture.run();
            assert.equal(result.status, 0, `${mode}: ${result.stderr}`);
            assert.equal(await fs.stat(fixture.ensureMarker).then(() => true, () => false), true);
            assert.equal(await fs.stat(fixture.providerMarker).then(() => true, () => false), false);
            assert.equal(await fs.stat(fixture.nodeMarker).then(() => true, () => false), false);
        }
    });

    test(`${implementation.agent} readiness derives state from HOME and cannot inspect a real workspace`, async () => {
        const source = await fs.readFile(implementation.source, 'utf8');
        assert.match(source, /\$HOME/);
        assert.doesNotMatch(source, /HOME:-}" = "\/(?:home\/agent|root)"/);
        for (const forbidden of [
            'PLOINKY_WORKSPACE_ROOT',
            '/workspace',
            'check-task-sandbox',
            '--version',
            '/root/',
            '/home/agent/',
            'eval ',
        ]) {
            assert.equal(source.includes(forbidden), false, forbidden);
        }
    });

    test(`${implementation.agent} Bubblewrap capability gate accepts only the fd-safe image contract`, async (t) => {
        const valid = await makeCapabilityFixture(t, implementation);
        const result = spawnSync('/bin/sh', [valid.scriptPath], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(
            (await fs.readFile(valid.probeLog, 'utf8')).trim().split('\n'),
            ['bwrap:--help', 'helper:--capabilities'],
        );

        const formatted = await makeCapabilityFixture(t, implementation, {
            bwrapHelp: REQUIRED_BWRAP_OPTIONS
                .map((value) => `    ${value}                pinned Bubblewrap description`)
                .join('\n'),
        });
        const formattedResult = spawnSync('/bin/sh', [formatted.scriptPath], { encoding: 'utf8' });
        assert.equal(formattedResult.status, 0, formattedResult.stderr);

        for (const requiredOption of REQUIRED_BWRAP_OPTIONS) {
            const invalid = await makeCapabilityFixture(t, implementation, {
                bwrapHelp: REQUIRED_BWRAP_OPTIONS.filter((value) => value !== requiredOption).join('\n'),
            });
            const failure = spawnSync('/bin/sh', [invalid.scriptPath], { encoding: 'utf8' });
            assert.notEqual(failure.status, 0, requiredOption);
            assert.match(failure.stderr, /PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE/);
        }

        for (const requiredCapability of REQUIRED_HELPER_CAPABILITIES) {
            const invalid = await makeCapabilityFixture(t, implementation, {
                helperCapabilities: REQUIRED_HELPER_CAPABILITIES
                    .filter((value) => value !== requiredCapability)
                    .join(' '),
            });
            const failure = spawnSync('/bin/sh', [invalid.scriptPath], { encoding: 'utf8' });
            assert.notEqual(failure.status, 0, requiredCapability);
            assert.match(failure.stderr, /PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE/);
        }

        for (const bwrapHelp of [
            REQUIRED_BWRAP_OPTIONS.map((value) => `${value}extra`).join('\n'),
            REQUIRED_BWRAP_OPTIONS.map((value) => value.replace(' DEST', ' DESTROY')).join('\n'),
        ]) {
            const invalid = await makeCapabilityFixture(t, implementation, { bwrapHelp });
            const failure = spawnSync('/bin/sh', [invalid.scriptPath], { encoding: 'utf8' });
            assert.notEqual(failure.status, 0, bwrapHelp);
            assert.match(failure.stderr, /PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE/);
        }

        for (const helperCapabilities of [
            REQUIRED_HELPER_CAPABILITIES.join(' ').replace(/[0-9a-f]{40}/, ''),
            REQUIRED_HELPER_CAPABILITIES.join(' ').replace(/[0-9a-f]{40}/, 'g'.repeat(40)),
            `${REQUIRED_HELPER_CAPABILITIES.join(' ')} unexpected=capability`,
        ]) {
            const invalid = await makeCapabilityFixture(t, implementation, { helperCapabilities });
            const failure = spawnSync('/bin/sh', [invalid.scriptPath], { encoding: 'utf8' });
            assert.notEqual(failure.status, 0, helperCapabilities);
            assert.match(failure.stderr, /PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE/);
        }
    });

    test(`${implementation.agent} Bubblewrap capability gate never installs or mutates the runtime`, async (t) => {
        for (const missing of ['bwrap', 'helper']) {
            const fixture = await makeCapabilityFixture(t, implementation, {
                includeBwrap: missing !== 'bwrap',
                includeHelper: missing !== 'helper',
            });
            const fakeBin = path.join(fixture.root, 'bin');
            const mutationMarker = path.join(fixture.root, 'apt-get-executed');
            await writeExecutable(path.join(fakeBin, 'id'), '#!/bin/sh\necho 0\n');
            await writeExecutable(path.join(fakeBin, 'apt-get'), `#!/bin/sh\n: > '${mutationMarker}'\nexit 0\n`);
            const result = spawnSync('/bin/sh', [fixture.scriptPath], {
                encoding: 'utf8',
                env: { PATH: `${fakeBin}:/usr/bin:/bin` },
            });
            assert.notEqual(result.status, 0, missing);
            assert.match(result.stderr, /PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE/);
            assert.equal(await fs.stat(mutationMarker).then(() => true, () => false), false);
        }

        const source = await fs.readFile(implementation.ensureSource, 'utf8');
        for (const forbidden of ['apt-get', 'DEBIAN_FRONTEND', 'apk ', 'dnf ', 'yum ']) {
            assert.equal(source.includes(forbidden), false, forbidden);
        }
    });
}

test('OpenCode and PI share an identical Bubblewrap capability contract', async () => {
    const [openCode, pi] = await Promise.all(
        implementations.map(({ ensureSource }) => fs.readFile(ensureSource, 'utf8')),
    );
    assert.equal(openCode, pi);
});
