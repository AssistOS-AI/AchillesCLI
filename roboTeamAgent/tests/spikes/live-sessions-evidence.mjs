import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { SOCKET_PATHS } from './live-sessions-process-probe.mjs';

function requireSocketSet(records, label) {
    assert.ok(Array.isArray(records), `${label} records are required`);
    assert.deepEqual(records.map(entry => entry?.socketPath).sort(), [...SOCKET_PATHS].sort(),
        `${label} must contain exactly the selected socket set`);
}

// Inputs are redacted JSON records only, never container logs, environment
// dumps, envelopes or credentials. Coordinator supplies checked identities.
export async function assembleEvidence(directory) {
    const read = async name => JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
    const pins = await read('runtime-pins.json');
    assert.equal(pins.workspace, path.join(os.homedir(), 'work', 'testExplorerFresh'));
    assert.equal(pins.branch, 'live-sessions');
    for (const name of ['ploinky', 'AssistOSExplorer', 'AchillesCLI', 'AdvancedLanguageAgent']) {
        assert.match(pins.revisions?.[name], /^[a-f0-9]{40}$/);
    }
    for (const name of ['box', 'roboTeam']) {
        assert.match(pins.images?.[name]?.digest, /^sha256:[a-f0-9]{64}$/);
        assert.match(pins.images?.[name]?.id, /^sha256:[a-f0-9]{64}$/);
        assert.match(pins.containers?.[name], /^[a-f0-9]{64}$/);
    }
    assert.match(pins.candidateManifestSha256, /^[a-f0-9]{64}$/);
    assert.match(pins.readinessEvidenceSha256, /^[a-f0-9]{64}$/);
    const before = await read('cli-before.json');
    const after = await read('cli-after.json');
    const service = await read('service-probe.json');
    const sandbox = await read('sandbox-result.json');
    const owner = await read('owner-result.json');
    assert.equal(sandbox.status, 'passed');
    assert.equal(owner.status, 'passed');
    requireSocketSet(service, 'Service');
    requireSocketSet(before, 'CLI before');
    requireSocketSet(after, 'CLI after');
    requireSocketSet(sandbox.before, 'Sandbox trusted before');
    requireSocketSet(sandbox.after, 'Sandbox trusted after');
    requireSocketSet(sandbox.plan?.sockets, 'Sandbox plan');
    for (const socket of sandbox.plan.sockets) {
        assert.ok(typeof socket.realpath === 'string' && path.posix.isAbsolute(socket.realpath), 'Socket realpath is required');
        assert.ok(Array.isArray(socket.aliases), 'Socket aliases are required');
        assert.equal(new Set(socket.aliases).size, socket.aliases.length, 'Socket aliases must be unique');
        assert.ok(socket.aliases.every(alias => typeof alias === 'string' && path.posix.isAbsolute(alias)), 'Socket aliases must be absolute paths');
        assert.ok(socket.aliases.includes(socket.socketPath), 'Socket aliases must include the direct path');
        assert.ok(socket.aliases.includes(socket.realpath), 'Socket aliases must include its realpath');
    }
    for (const socketPath of SOCKET_PATHS) {
        const main = service.find(entry => entry.kind === 'service-ready' && entry.socketPath === socketPath);
        assert.ok(main);
        for (const controls of [before, after]) {
            const cli = controls.find(entry => entry.kind === 'cli-connected' && entry.socketPath === socketPath);
            assert.ok(cli);
            assert.equal(cli.service.pid, main.pid);
            assert.notEqual(cli.client.pid, main.pid);
            assert.equal(cli.client.uid, main.uid);
            assert.equal(cli.client.mountNamespace, main.mountNamespace);
            assert.equal(cli.incarnationDigest, main.incarnationDigest);
            assert.match(cli.challengeDigest, /^[a-f0-9]{64}$/);
        }
        assert.notEqual(before.find(entry => entry.socketPath === socketPath).challengeDigest,
            after.find(entry => entry.socketPath === socketPath).challengeDigest);
        for (const controls of [sandbox.before, sandbox.after]) {
            const control = controls.find(entry => entry.socketPath === socketPath);
            assert.equal(control?.incarnationDigest, main.incarnationDigest);
            assert.equal(control?.service.pid, main.pid);
        }
    }
    const expected = [...new Set(sandbox.plan.sockets.flatMap(entry => entry.aliases))].sort();
    assert.deepEqual(sandbox.observed.results.map(entry => entry.path).sort(), expected);
    assert.ok(expected.length >= SOCKET_PATHS.length);
    assert.ok(sandbox.observed.results.every(entry => entry.error === 'ENOENT'));
    assert.match(sandbox.backendSha256, /^[a-f0-9]{64}$/);
    assert.match(sandbox.plan.wrapperSha256, /^[a-f0-9]{64}$/);
    const sourceChecks = ['real-router-serializer-minter', 'raw-hash', 'wrong-tuple', 'jti-replay', 'text', 'presentation', 'tool', 'audience', 'expiry', 'receive-preparation-delay'];
    for (const check of sourceChecks) assert.ok(owner.checks.includes(check), `Missing owner probe check: ${check}`);
    assert.ok(owner.started.some(entry => entry.startedAt > entry.expiresAt && entry.admittedAt < entry.expiresAt));
    const commands = await read('commands.json');
    assert.ok(Array.isArray(commands) && commands.length >= 5);
    assert.ok(commands.every(entry => typeof entry.command === 'string' && entry.exitCode === 0));
    // Project only known metadata; unknown input keys never enter artifacts.
    const manifest = { version: 1, diagnosticOnly: true, createdAt: new Date().toISOString(),
        selectedSocketPath: SOCKET_PATHS[0],
        workspace: pins.workspace, branch: pins.branch,
        revisions: Object.fromEntries(['ploinky', 'AssistOSExplorer', 'AchillesCLI', 'AdvancedLanguageAgent'].map(name => [name, pins.revisions[name]])),
        images: Object.fromEntries(['box', 'roboTeam'].map(name => [name, { digest: pins.images[name].digest, id: pins.images[name].id }])),
        containers: Object.fromEntries(['box', 'roboTeam'].map(name => [name, pins.containers[name]])),
        candidateManifestSha256: pins.candidateManifestSha256,
        readinessEvidenceSha256: pins.readinessEvidenceSha256,
        checks: { sameUidAndMountNamespace: true, realCliBeforeAfter: true,
            allSocketAliasesAbsent: true, realRouterOwnerProbe: true },
        inputHashes: {} };
    for (const name of ['runtime-pins.json', 'cli-before.json', 'cli-after.json', 'service-probe.json',
        'sandbox-result.json', 'owner-result.json', 'commands.json']) {
        manifest.inputHashes[name] = createHash('sha256').update(await fs.readFile(path.join(directory, name))).digest('hex');
    }
    await fs.writeFile(path.join(directory, 'p3-spike.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await fs.writeFile(path.join(directory, 'p3-spike.txt'),
        'P3.0 diagnostic checks passed. Production publishing and release gates remain pending.\n'
        + `Candidate manifest SHA256: ${manifest.candidateManifestSha256}\n`
        + `Selected socket: ${manifest.selectedSocketPath}\n`
        + `Socket alias probes: ${expected.length}; every result ENOENT.\n`
        + 'Real service and CLI identity controls agree before and after the sandbox run.\n'
        + 'Real Router minting, expiry, replay, tampering and receive/preparation delay checks passed.\n', { flag: 'wx', mode: 0o600 });
    return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try { await assembleEvidence(await fs.realpath(process.argv[2])); }
    catch { console.error('P3 evidence incomplete or inconsistent; no success claim is available.'); process.exitCode = 1; }
}
