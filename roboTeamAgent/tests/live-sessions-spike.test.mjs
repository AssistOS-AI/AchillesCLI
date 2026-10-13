import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { listenProbe, connectProbe, SOCKET_PATHS } from './spikes/live-sessions-process-probe.mjs';
import { captureGrants, aliasesFor, parseMountInfo } from './spikes/live-sessions-sandbox.mjs';
import { assembleEvidence } from './spikes/live-sessions-evidence.mjs';

const identity = { pid: process.pid, uid: process.getuid(), mountNamespace: 'mnt:[1234]' };
async function fixture(t) {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ls-spike-')));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return { root, socketPath: path.join(root, 'private', 'registry.sock') };
}

test('fixed entrypoint gates import nothing for every off state and preserve commands', async () => {
    for (const name of ['main', 'robot-cli']) {
        const source = await fs.readFile(new URL(`../server/${name}.mjs`, import.meta.url), 'utf8');
        const gate = source.match(/^( *)if \(process\.env\.ROBOTEAM_LIVE_SESSIONS_SPIKE === '1'\) \{[\s\S]*?\n\1\}/m)?.[0];
        assert.ok(gate);
        assert.match(gate, /import\('\.\.\/tests\/spikes\/live-sessions-process-probe\.mjs'\)/);
        for (const value of [undefined, '', '0', 'true', '2', ' 1']) {
            let imports = 0;
            const fn = new (async () => {}).constructor('process', 'load', 'liveSessionsSpike',
                gate.replace("import('../tests/spikes/live-sessions-process-probe.mjs')", 'load()'));
            await fn({ env: { ROBOTEAM_LIVE_SESSIONS_SPIKE: value } }, () => { imports++; throw new Error('Unexpected diagnostic I/O'); });
            assert.equal(imports, 0);
        }
    }
    const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url)));
    assert.equal(manifest.agent, 'sh /code/scripts/startAgent.sh');
    assert.equal(manifest.cli, 'node /code/server/robot-cli.mjs');
    assert.ok(manifest.profiles.default.env.includes('ROBOTEAM_LIVE_SESSIONS_SPIKE'));
    assert.deepEqual(SOCKET_PATHS, ['/dev/shm/roboteam-live/registry.sock', '/run/roboteam-live/registry.sock']);
});

test('private listener accepts a fresh challenge and cleans up its exact identities', async t => {
    const { socketPath } = await fixture(t);
    const listener = await listenProbe(socketPath, identity);
    try {
        assert.equal((await fs.stat(path.dirname(socketPath))).mode & 0o777, 0o700);
        assert.equal((await fs.stat(socketPath)).mode & 0o777, 0o600);
        const observed = await connectProbe(socketPath, identity, listener.incarnationDigest);
        assert.equal(observed.service.pid, process.pid);
        assert.equal(observed.client.pid, process.pid);
        assert.equal(observed.incarnationDigest, listener.incarnationDigest);
        await assert.rejects(listenProbe(socketPath, identity), { code: 'EEXIST' });
        await assert.rejects(connectProbe(socketPath, identity, '0'.repeat(64)), /incarnation/);
        await assert.rejects(connectProbe(socketPath, { ...identity, uid: identity.uid + 1 }), /identity/);
    } finally { await listener.close(); }
    await assert.rejects(fs.lstat(path.dirname(socketPath)), { code: 'ENOENT' });
});

test('preexisting directory and symlink are refused without adoption or unlink', async t => {
    const { root, socketPath } = await fixture(t);
    const directory = path.dirname(socketPath);
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'sentinel'), 'preserve');
    await assert.rejects(listenProbe(socketPath, identity), { code: 'EEXIST' });
    assert.equal(await fs.readFile(path.join(directory, 'sentinel'), 'utf8'), 'preserve');
    await fs.symlink(directory, path.join(root, 'alias'));
    await assert.rejects(listenProbe(path.join(root, 'alias', 'registry.sock'), identity), { code: 'EEXIST' });
    assert.ok((await fs.lstat(path.join(root, 'alias'))).isSymbolicLink());
});

test('malformed and oversized clients leave the listener available', async t => {
    const { socketPath } = await fixture(t);
    const listener = await listenProbe(socketPath, identity);
    try {
        for (const message of ['not-json\n', 'x'.repeat(4097), '{}\n', '{}\n{}\n']) {
            const socket = net.connect(socketPath);
            socket.on('error', () => {});
            const closed = once(socket, 'close');
            socket.write(message);
            await closed;
            assert.equal((await connectProbe(socketPath, identity)).service.pid, identity.pid);
        }
    } finally { await listener.close(); }
});

test('client rejects a response for another challenge', async t => {
    const { socketPath } = await fixture(t);
    await fs.mkdir(path.dirname(socketPath));
    const server = net.createServer(socket => socket.once('data', () => socket.end(JSON.stringify({
        version: 1, challenge: '0'.repeat(64), incarnation: '1'.repeat(64), ...identity,
    }) + '\n')));
    await new Promise(resolve => server.listen(socketPath, resolve));
    try { await assert.rejects(connectProbe(socketPath, identity), /challenge/); }
    finally { await new Promise(resolve => server.close(resolve)); }
});

test('a stalled client is closed at the five-second deadline', { timeout: 7000 }, async t => {
    const { socketPath } = await fixture(t);
    const listener = await listenProbe(socketPath, identity);
    try {
        const socket = net.connect(socketPath);
        const closed = once(socket, 'close');
        socket.write('{');
        await closed;
        assert.equal((await connectProbe(socketPath, identity)).service.pid, identity.pid);
    } finally { await listener.close(); }
});

test('cleanup refuses replacement identities without deleting them', async t => {
    const { socketPath } = await fixture(t);
    const listener = await listenProbe(socketPath, identity);
    const moved = path.dirname(socketPath) + '-moved';
    await fs.rename(path.dirname(socketPath), moved);
    await fs.mkdir(path.dirname(socketPath));
    await fs.writeFile(socketPath, 'replacement');
    await assert.rejects(listener.close(), /changed identity/);
    assert.equal(await fs.readFile(socketPath, 'utf8'), 'replacement');
    await fs.unlink(socketPath);
    await fs.rmdir(path.dirname(socketPath));
    await fs.rename(moved, path.dirname(socketPath));
    await listener.close();
});

test('actual grant capture excludes environment values and discovers bind aliases by mount identity', () => {
    const grants = captureGrants(['--ro-bind', '/workspace', '/workspace', '--bind', '/data', '/robot-data',
        '--dev', '/dev', '--tmpfs', '/tmp', '--setenv', 'CREDENTIAL', 'never-record-this', '--', '/usr/bin/node']);
    assert.equal(JSON.stringify(grants).includes('never-record-this'), false);
    assert.equal(grants[0].permission, 'ro');
    assert.equal(grants[1].permission, 'rw');
    const mounts = parseMountInfo('1 0 0:1 / / rw - overlay overlay rw\n'
        + '2 1 0:2 / /dev/shm rw - tmpfs shm rw\n'
        + '3 1 0:2 / /data rw - tmpfs shm rw\n'
        + '4 1 0:2 / /workspace/.data/roboTeamAgent rw - tmpfs shm rw\n');
    assert.deepEqual(aliasesFor('/dev/shm/roboteam-live/registry.sock', grants, mounts, value => value),
        ['/dev/shm/roboteam-live/registry.sock', '/robot-data/roboteam-live/registry.sock',
            '/workspace/.data/roboTeamAgent/roboteam-live/registry.sock']);
    assert.throws(() => captureGrants(['--', '/usr/bin/node']), /actual ALA/);
});

test('missing runtime evidence never creates a passing artifact', async t => {
    const { root } = await fixture(t);
    await assert.rejects(assembleEvidence(root), { code: 'ENOENT' });
    await assert.rejects(fs.lstat(path.join(root, 'p3-spike.txt')), { code: 'ENOENT' });
    await assert.rejects(fs.lstat(path.join(root, 'p3-spike.json')), { code: 'ENOENT' });
});

test('owner evidence without the wrong-tuple control cannot produce passing artifacts', async t => {
    const { root } = await fixture(t);
    const hash = 'a'.repeat(64);
    const service = SOCKET_PATHS.map(socketPath => ({ kind: 'service-ready', socketPath,
        pid: 77, uid: 1, mountNamespace: 'mnt:[77]', incarnationDigest: hash }));
    const controls = challengeDigest => service.map(entry => ({ kind: 'cli-connected', socketPath: entry.socketPath,
        service: { pid: entry.pid }, client: { pid: 78, uid: entry.uid, mountNamespace: entry.mountNamespace },
        incarnationDigest: entry.incarnationDigest, challengeDigest }));
    const before = controls(hash);
    const after = controls('b'.repeat(64));
    const owner = { status: 'passed', checks: ['real-router-serializer-minter', 'raw-hash', 'jti-replay',
        'text', 'presentation', 'tool', 'audience', 'expiry', 'receive-preparation-delay'],
        started: [{ admittedAt: 1, expiresAt: 2, startedAt: 3 }] };
    const files = {
        'runtime-pins.json': { workspace: path.join(os.homedir(), 'work', 'testExplorerFresh'), branch: 'live-sessions',
            revisions: Object.fromEntries(['ploinky', 'AssistOSExplorer', 'AchillesCLI', 'AdvancedLanguageAgent'].map(name => [name, 'a'.repeat(40)])),
            images: Object.fromEntries(['box', 'roboTeam'].map(name => [name, { digest: `sha256:${hash}`, id: `sha256:${hash}` }])),
            containers: { box: hash, roboTeam: hash }, candidateManifestSha256: hash, readinessEvidenceSha256: hash },
        'service-probe.json': service, 'cli-before.json': before, 'cli-after.json': after,
        'owner-result.json': owner,
        'sandbox-result.json': { status: 'passed', before, after, backendSha256: hash,
            plan: { wrapperSha256: hash, sockets: SOCKET_PATHS.map(socketPath => ({ aliases: [socketPath] })) },
            observed: { results: SOCKET_PATHS.map(socketPath => ({ path: socketPath, error: 'ENOENT' })) } },
        'commands.json': Array.from({ length: 5 }, () => ({ command: 'diagnostic fixture', exitCode: 0 })),
    };
    for (const [name, value] of Object.entries(files)) await fs.writeFile(path.join(root, name), JSON.stringify(value));
    await assert.rejects(assembleEvidence(root), /wrong-tuple/);
    await assert.rejects(fs.lstat(path.join(root, 'p3-spike.txt')), { code: 'ENOENT' });
    await assert.rejects(fs.lstat(path.join(root, 'p3-spike.json')), { code: 'ENOENT' });
    owner.checks.push('wrong-tuple');
    await fs.writeFile(path.join(root, 'owner-result.json'), JSON.stringify(owner));
    const correctWorkspace = files['runtime-pins.json'].workspace;
    files['runtime-pins.json'].workspace = path.join(os.homedir(), 'work', 'different-workspace');
    await fs.writeFile(path.join(root, 'runtime-pins.json'), JSON.stringify(files['runtime-pins.json']));
    await assert.rejects(assembleEvidence(root), { code: 'ERR_ASSERTION' });
    await assert.rejects(fs.lstat(path.join(root, 'p3-spike.json')), { code: 'ENOENT' });
    files['runtime-pins.json'].workspace = correctWorkspace;
    await fs.writeFile(path.join(root, 'runtime-pins.json'), JSON.stringify(files['runtime-pins.json']));
    assert.equal((await assembleEvidence(root)).checks.realRouterOwnerProbe, true);
});
