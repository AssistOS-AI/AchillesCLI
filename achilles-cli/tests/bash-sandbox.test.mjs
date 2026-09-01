import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { AchillesBroker, runBrokeredMainAgent } from '../src/broker/AchillesBroker.mjs';
import {
    assertCurrentProcfs,
    buildSandboxArgs,
    canMountPrivateProc,
    findBubblewrap,
    inspectCurrentProcfs,
    resolveGeneratedRouterDescriptorMount,
} from '../src/broker/sandbox.mjs';
import { BrokerClient } from '../src/permissions/BrokerClient.mjs';
import { createBashExecutor } from '../src/permissions/LocalBashExecutor.mjs';
import { action as runBashSkill } from '../src/skills/bash/src/index.mjs';
import {
    createWebchatApprovalInteraction,
    parseWebchatInteractionResponse,
    PERMISSION_MODES,
} from '../src/permissions/protocol.mjs';

const bwrap = findBubblewrap();
const sandboxAvailable = canCreateSandbox();
const localBashExecutorUrl = new URL('../src/permissions/LocalBashExecutor.mjs', import.meta.url).href;

test('Bash skill contains execution only and delegates structured params', async () => {
    const calls = [];
    const result = await runBashSkill({
        promptText: 'printf hello',
        bashExecutor: async (params) => {
            calls.push(params);
            return { success: true, output: 'hello' };
        },
    });

    assert.equal(result, 'hello');
    assert.deepEqual(calls, [{
        command: 'printf',
        args: ['hello'],
        raw: 'printf hello',
    }]);
});

test('Bash skill fails closed when the sandboxed executor is unavailable', async () => {
    const result = await runBashSkill({ promptText: 'echo hello' });
    assert.match(result, /sandboxed Bash executor is unavailable/i);
});

test('local Bash executor starts the requested command directly without another bwrap', async () => {
    const calls = [];
    const executor = createBashExecutor({
        cwd: '/workspace',
        env: { TEST_ENV: '1' },
        execute: async (request) => {
            calls.push(request);
            return { success: true, status: 0, stdout: 'ok\n', stderr: '' };
        },
    });

    const result = await executor({ command: '/usr/bin/printf', args: ['ok'], raw: 'printf ok' });

    assert.equal(result.output, 'ok');
    assert.deepEqual(calls, [{
        command: '/usr/bin/printf',
        args: ['ok'],
        cwd: '/workspace',
        env: { TEST_ENV: '1' },
    }]);
});

test('Bash skill returns only the execution error', async () => {
    const result = await runBashSkill({
        promptText: 'false',
        bashExecutor: async () => ({
            success: false,
            error: 'Command exited with status 1.',
        }),
    });

    assert.equal(result, 'Error: Command exited with status 1.');
});

test('sandbox uses an empty proc directory when nested proc mounts are unavailable', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-empty-proc-'));
    try {
        const args = buildSandboxArgs({
            workspace,
            command: '/usr/bin/true',
            privateProc: false,
        });
        const procIndex = args.findIndex((entry, index) => entry === '--dir' && args[index + 1] === '/proc');
        assert.notEqual(procIndex, -1);
        assert.equal(args.some((entry, index) => entry === '--proc' && args[index + 1] === '/proc'), false);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('sandbox exposes an outer AchillesCLI private root as a separate writable mount', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-nested-private-mount-'));
    const workspaceRoot = path.join(root, 'workspace');
    const selectedDirectory = path.join(workspaceRoot, 'projects', 'nested');
    const privateDataRoot = path.join(workspaceRoot, '.data', 'achilles-cli');
    fs.mkdirSync(selectedDirectory, { recursive: true });
    fs.mkdirSync(privateDataRoot, { recursive: true });
    try {
        const resolvedPrivateRoot = fs.realpathSync(privateDataRoot);
        const args = buildSandboxArgs({
            workspace: selectedDirectory,
            command: '/usr/bin/true',
            extraWritablePaths: [privateDataRoot],
            privateProc: false,
        });
        assert.notEqual(args.findIndex((entry, index) => (
            entry === '--bind'
            && args[index + 1] === resolvedPrivateRoot
            && args[index + 2] === resolvedPrivateRoot
        )), -1);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('nested Ploinky sandbox can write the validated outer private root', {
    skip: !sandboxAvailable,
}, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-nested-private-launch-'));
    const workspaceRoot = path.join(root, 'workspace');
    const selectedDirectory = path.join(workspaceRoot, 'projects', 'nested');
    const probePath = path.join(selectedDirectory, 'write-private-root.mjs');
    const outputPath = path.join(workspaceRoot, '.data', 'achilles-cli', 'launch-proof.txt');
    fs.mkdirSync(selectedDirectory, { recursive: true });
    fs.writeFileSync(probePath, [
        "import fs from 'node:fs';",
        `fs.writeFileSync(${JSON.stringify(outputPath)}, 'writable');`,
    ].join('\n'));
    const previousWorkspaceRoot = process.env.PLOINKY_WORKSPACE_ROOT;
    process.env.PLOINKY_WORKSPACE_ROOT = workspaceRoot;
    try {
        const exitCode = await runBrokeredMainAgent({
            workspace: selectedDirectory,
            argv: [],
            entryPath: probePath,
        });
        assert.equal(exitCode, 0);
        assert.equal(fs.readFileSync(outputPath, 'utf8'), 'writable');
    } finally {
        if (previousWorkspaceRoot === undefined) delete process.env.PLOINKY_WORKSPACE_ROOT;
        else process.env.PLOINKY_WORKSPACE_ROOT = previousWorkspaceRoot;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('private proc capability probe returns a boolean', () => {
    assert.equal(typeof canMountPrivateProc(bwrap), 'boolean');
});

test('generated-local descriptor is exposed to the MainAgent sandbox only from the fixed runtime mount', () => {
    const descriptorPath = '/run/ploinky/router-descriptor.json';
    const fsApi = {
        lstatSync: (target) => {
            assert.equal(target, descriptorPath);
            return {
                isFile: () => true,
                isSymbolicLink: () => false,
                mode: 0o100600,
                size: 1024,
                uid: 1000,
                gid: 1000,
            };
        },
        realpathSync: (target) => target,
    };
    const descriptorMount = resolveGeneratedRouterDescriptorMount({
        env: {
            PLOINKY_ROUTER_DESCRIPTOR_FILE: descriptorPath,
            PLOINKY_ENV_SOURCE_PLOINKY_ROUTER_DESCRIPTOR_FILE: 'generated',
        },
        fsApi,
        expectedUid: 1000,
        expectedGid: 1000,
    });
    assert.equal(descriptorMount, descriptorPath);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-router-descriptor-'));
    const workspace = path.join(root, 'workspace');
    const runtimeFile = path.join(root, 'runtime-descriptor.json');
    fs.mkdirSync(workspace);
    fs.writeFileSync(runtimeFile, '{}\n', { mode: 0o600 });
    try {
        const resolvedRuntimeFile = fs.realpathSync(runtimeFile);
        const args = buildSandboxArgs({
            workspace,
            command: '/usr/bin/true',
            extraReadOnlyPaths: [runtimeFile],
            privateProc: false,
        });
        const bindIndex = args.findIndex((entry, index) => (
            entry === '--ro-bind'
            && args[index + 1] === resolvedRuntimeFile
            && args[index + 2] === resolvedRuntimeFile
        ));
        assert.notEqual(bindIndex, -1);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('generated-local descriptor mount rejects forged provenance and unsafe filesystem identity', () => {
    const descriptorPath = '/run/ploinky/router-descriptor.json';
    const safeStat = {
        isFile: () => true,
        isSymbolicLink: () => false,
        mode: 0o100600,
        size: 1024,
        uid: 1000,
        gid: 1000,
    };
    const generatedEnv = {
        PLOINKY_ROUTER_DESCRIPTOR_FILE: descriptorPath,
        PLOINKY_ENV_SOURCE_PLOINKY_ROUTER_DESCRIPTOR_FILE: 'generated',
    };
    assert.throws(
        () => resolveGeneratedRouterDescriptorMount({
            env: { ...generatedEnv, PLOINKY_ROUTER_DESCRIPTOR_FILE: '/tmp/forged.json' },
        }),
        /untrusted generated-local Router descriptor mount/,
    );
    assert.throws(
        () => resolveGeneratedRouterDescriptorMount({
            env: { ...generatedEnv, PLOINKY_ENV_SOURCE_PLOINKY_ROUTER_DESCRIPTOR_FILE: 'explicit' },
        }),
        /untrusted generated-local Router descriptor mount/,
    );
    assert.throws(
        () => resolveGeneratedRouterDescriptorMount({
            env: generatedEnv,
            fsApi: {
                lstatSync: () => ({ ...safeStat, mode: 0o100644 }),
                realpathSync: (target) => target,
            },
            expectedUid: 1000,
            expectedGid: 1000,
        }),
        /unsafe filesystem identity/,
    );
    assert.throws(
        () => resolveGeneratedRouterDescriptorMount({
            env: generatedEnv,
            fsApi: {
                lstatSync: () => ({ ...safeStat, uid: 1001 }),
                realpathSync: (target) => target,
            },
            expectedUid: 1000,
            expectedGid: 1000,
        }),
        /unsafe filesystem identity/,
    );
    assert.throws(
        () => resolveGeneratedRouterDescriptorMount({
            env: generatedEnv,
            fsApi: {
                lstatSync: () => safeStat,
                realpathSync: () => '/tmp/replaced.json',
            },
            expectedUid: 1000,
            expectedGid: 1000,
        }),
        /escaped its fixed runtime path/,
    );
});

test('generated-local descriptor mount fails closed for incomplete or unavailable runtime state', () => {
    const descriptorPath = '/run/ploinky/router-descriptor.json';
    const generatedEnv = {
        PLOINKY_ROUTER_DESCRIPTOR_FILE: descriptorPath,
        PLOINKY_ENV_SOURCE_PLOINKY_ROUTER_DESCRIPTOR_FILE: 'generated',
    };
    const safeStat = {
        isFile: () => true,
        isSymbolicLink: () => false,
        mode: 0o100600,
        size: 1024,
        uid: 1000,
        gid: 1000,
    };
    assert.equal(resolveGeneratedRouterDescriptorMount({ env: {} }), null);
    assert.throws(
        () => resolveGeneratedRouterDescriptorMount({
            env: { PLOINKY_ROUTER_DESCRIPTOR_FILE: descriptorPath },
        }),
        /untrusted generated-local Router descriptor mount/,
    );
    assert.throws(
        () => resolveGeneratedRouterDescriptorMount({
            env: generatedEnv,
            fsApi: { lstatSync: () => { throw new Error('missing'); } },
        }),
        /descriptor is unavailable/,
    );
    for (const unsafeStat of [
        { ...safeStat, isFile: () => false },
        { ...safeStat, isSymbolicLink: () => true },
        { ...safeStat, size: 0 },
        { ...safeStat, size: (64 * 1024) + 1 },
        { ...safeStat, gid: 1001 },
    ]) {
        assert.throws(
            () => resolveGeneratedRouterDescriptorMount({
                env: generatedEnv,
                fsApi: {
                    lstatSync: () => unsafeStat,
                    realpathSync: (target) => target,
                },
                expectedUid: 1000,
                expectedGid: 1000,
            }),
            /unsafe filesystem identity/,
        );
    }
    assert.throws(
        () => resolveGeneratedRouterDescriptorMount({
            env: generatedEnv,
            fsApi: {
                lstatSync: () => safeStat,
                realpathSync: () => { throw new Error('unresolvable'); },
            },
            expectedUid: 1000,
            expectedGid: 1000,
        }),
        /descriptor cannot be resolved/,
    );
});

test('procfs invariant accepts the current PID namespace view', () => {
    const fsApi = {
        readlinkSync: (target) => {
            assert.equal(target, '/proc/self');
            return '321';
        },
        existsSync: (target) => {
            assert.equal(target, '/proc/321/ns/pid');
            return true;
        },
    };

    assert.deepEqual(inspectCurrentProcfs({ fsApi, pid: 321 }), {
        ok: true,
        processPid: 321,
        procSelfPid: 321,
        pidNamespaceVisible: true,
        error: null,
    });
    assert.equal(assertCurrentProcfs({ fsApi, pid: 321 }).ok, true);
});

test('procfs invariant rejects a proc mount from a parent PID namespace', () => {
    const fsApi = {
        readlinkSync: () => '90210',
        existsSync: () => false,
    };

    assert.deepEqual(inspectCurrentProcfs({ fsApi, pid: 321 }), {
        ok: false,
        processPid: 321,
        procSelfPid: 90210,
        pidNamespaceVisible: false,
        error: null,
    });
    assert.throws(
        () => assertCurrentProcfs({ fsApi, pid: 321 }),
        /process PID 321, \/proc\/self 90210.*Do not bind a parent container's \/proc/,
    );
});

test('WebChat approval protocol orders always approve first and parses control responses', () => {
    const interaction = createWebchatApprovalInteraction({
        id: 'approval_12345678',
        params: { raw: 'ls -la' },
    });
    assert.deepEqual(interaction.options.map((option) => option.id), ['always-allow', 'allow', 'deny']);
    assert.equal(interaction.defaultOptionId, 'always-allow');
    assert.deepEqual(parseWebchatInteractionResponse(JSON.stringify({
        __webchatInteractionResponse: 1,
        version: 1,
        id: interaction.id,
        optionId: 'always-allow',
    })), { id: interaction.id, optionId: 'always-allow' });
    assert.deepEqual(parseWebchatInteractionResponse(JSON.stringify({
        __webchatInteractionResponse: 1,
        version: 1,
        id: interaction.id,
        cancelled: true,
    })), { id: interaction.id, cancelled: true });
});

test('Broker socket returns async responses after the client half-closes its request', async () => {
    const fixture = createFixture();
    const broker = createBufferedBroker(fixture.workspace, PERMISSION_MODES.ASK);
    try {
        await broker.startServer();
        const client = new BrokerClient({ socketPath: broker.socketPath, timeoutMs: 1000 });
        const response = await client.getMode();
        assert.deepEqual(response, { ok: true, mode: PERMISSION_MODES.ASK });
    } finally {
        await broker.close();
        fixture.cleanup();
    }
});

test('Broker keeps the original authorization request suspended until WebChat resolves it', async () => {
    const fixture = createFixture();
    const output = [];
    const broker = new AchillesBroker({
        workspace: fixture.workspace,
        webchat: true,
        permissionMode: PERMISSION_MODES.ASK,
        stdout: { write: (chunk) => output.push(String(chunk)) },
        stderr: { write() {} },
        stdin: { isTTY: false },
    });
    try {
        await broker.startServer();
        const client = new BrokerClient({ socketPath: broker.socketPath, timeoutMs: 1000 });
        const control = new BrokerClient({
            socketPath: broker.socketPath,
            timeoutMs: 1000,
            controlToken: broker.controlToken,
        });
        const params = { command: '/usr/bin/printf', args: ['approved'], raw: 'printf approved' };
        let completed = false;
        const authorization = client.authorize('bash', params).then((result) => {
            completed = true;
            return result;
        });
        const pending = await waitForPending(broker);

        assert.equal(completed, false);
        assert.match(output.join(''), /"__webchatInteraction":1/);
        await control.resolvePendingApproval('allow', pending.id);
        const approved = await authorization;
        assert.equal(approved.status, 'approved');
        assert.equal(completed, true);
        assert.equal(typeof client.execute, 'undefined');
    } finally {
        await broker.close();
        fixture.cleanup();
    }
});

test('workspace sandbox allows writes inside the selected workspace', { skip: !sandboxAvailable }, async () => {
    const fixture = createFixture();
    try {
        const target = path.join(fixture.workspace, 'created.txt');
        const result = await runSandboxedBash(fixture, {
            command: '/usr/bin/touch',
            args: [target],
            raw: `touch ${target}`,
        });

        assert.equal(result.success, true);
        assert.equal(fs.existsSync(target), true);
    } finally {
        fixture.cleanup();
    }
});

test('Bash executor inherits the MainAgent sandbox and cannot read a sibling', { skip: !sandboxAvailable }, async () => {
    const fixture = createFixture();
    try {
        const result = await runSandboxedBash(fixture, {
            command: '/usr/bin/cat',
            args: [fixture.outsideFile],
            raw: `cat ${fixture.outsideFile}`,
        });

        assert.equal(result.success, false);
        assert.match(result.error, /No such file|Permission denied/i);
        assert.doesNotMatch(result.output, /outside-secret/);
    } finally {
        fixture.cleanup();
    }
});

test('Broker exposes authorization but no Bash execution endpoint', async () => {
    const fixture = createFixture();
    try {
        const broker = createBufferedBroker(fixture.workspace, PERMISSION_MODES.FULL);
        const result = await broker.handleRequest({
            type: 'bash.execute',
            toolName: 'bash',
            params: { command: '/usr/bin/true', args: [], raw: 'true' },
        });

        assert.equal(result.ok, false);
        assert.match(result.error, /Unknown broker request: bash\.execute/);
    } finally {
        fixture.cleanup();
    }
});

test('sandboxed Bash sees only its workspace when listing the host parent path', { skip: !sandboxAvailable }, async () => {
    const fixture = createFixture();
    try {
        const result = await runSandboxedBash(fixture, {
            command: '/usr/bin/ls',
            args: ['-1', fixture.root],
            raw: `ls -1 ${fixture.root}`,
        });

        assert.equal(result.success, true);
        assert.equal(result.output, 'workspace');
        assert.doesNotMatch(result.output, /outside/);
    } finally {
        fixture.cleanup();
    }
});

test('Bash approval permits execution but never widens the workspace sandbox', { skip: !sandboxAvailable }, async () => {
    const fixture = createFixture();
    try {
        const broker = createBufferedBroker(fixture.workspace, PERMISSION_MODES.ASK);
        const params = {
            command: '/usr/bin/cat',
            args: [fixture.outsideFile],
            raw: `cat ${fixture.outsideFile}`,
        };
        const authorization = broker.handleRequest({ type: 'bash.authorize', toolName: 'bash', params });
        const pending = await waitForPending(broker);

        await broker.handleRequest({
            type: 'approval.resolve',
            decision: 'allow',
            interactionId: pending.id,
            controlToken: broker.controlToken,
        });
        const approved = await authorization;
        const result = await runSandboxedBash(fixture, params);

        assert.equal(approved.status, 'approved');
        assert.equal(result.success, false);
        assert.match(result.error, /No such file|Permission denied/i);
        assert.doesNotMatch(result.output, /outside-secret/);
    } finally {
        fixture.cleanup();
    }
});

test('ask-for-approval does not execute Bash before a decision', async () => {
    const fixture = createFixture();
    try {
        const broker = createBufferedBroker(fixture.workspace, PERMISSION_MODES.ASK);
        const target = path.join(fixture.workspace, 'must-not-exist.txt');
        const authorization = broker.handleRequest({
            type: 'bash.authorize',
            toolName: 'bash',
            params: { command: '/usr/bin/touch', args: [target], raw: `touch ${target}` },
        });
        const pending = await waitForPending(broker);

        assert.equal(fs.existsSync(target), false);

        const resolved = await broker.handleRequest({
            type: 'approval.resolve',
            decision: 'deny',
            interactionId: pending.id,
            controlToken: broker.controlToken,
        });
        assert.equal(resolved.status, 'resolved');
        const denied = await authorization;
        assert.equal(denied.status, 'denied');
        assert.equal(denied.reason, 'The user denied this Bash command. It was not executed.');
        assert.equal(fs.existsSync(target), false);
    } finally {
        fixture.cleanup();
    }
});

test('permission mode changes require the trusted CLI control token', async () => {
    const fixture = createFixture();
    try {
        const broker = createBufferedBroker(fixture.workspace, PERMISSION_MODES.ASK);
        const rejected = await broker.handleRequest({
            type: 'permissions.set',
            mode: PERMISSION_MODES.FULL,
        });
        assert.equal(rejected.ok, false);
        assert.equal(broker.permissionMode, PERMISSION_MODES.ASK);

        const accepted = await broker.handleRequest({
            type: 'permissions.set',
            mode: PERMISSION_MODES.FULL,
            controlToken: broker.controlToken,
        });
        assert.equal(accepted.ok, true);
        assert.equal(broker.permissionMode, PERMISSION_MODES.FULL);
    } finally {
        fixture.cleanup();
    }
});

test('pending approvals cannot be resolved from the untrusted sandbox channel', async () => {
    const fixture = createFixture();
    try {
        const broker = createBufferedBroker(fixture.workspace, PERMISSION_MODES.ASK);
        const target = path.join(fixture.workspace, 'must-stay-absent.txt');
        const authorization = broker.handleRequest({
            type: 'bash.authorize',
            toolName: 'bash',
            params: { command: '/usr/bin/touch', args: [target], raw: `touch ${target}` },
        });
        const pending = await waitForPending(broker);

        const rejected = await broker.handleRequest({
            type: 'approval.resolve',
            interactionId: pending.id,
            decision: 'allow',
        });
        assert.equal(rejected.ok, false);
        assert.equal(fs.existsSync(target), false);
        assert.equal(Boolean(broker.pendingApproval), true);
        await broker.handleRequest({
            type: 'approval.resolve',
            interactionId: pending.id,
            decision: 'deny',
            controlToken: broker.controlToken,
        });
        await authorization;
    } finally {
        fixture.cleanup();
    }
});

test('always allow is reported to MainAgent while new params still require authorization', async () => {
    const fixture = createFixture();
    try {
        const broker = createBufferedBroker(fixture.workspace, PERMISSION_MODES.ASK);
        const params = { command: '/usr/bin/cat', args: [fixture.insideFile], raw: `cat ${fixture.insideFile}` };
        const firstAuthorization = broker.handleRequest({ type: 'bash.authorize', toolName: 'bash', params });
        const firstPending = await waitForPending(broker);
        await broker.handleRequest({
            type: 'approval.resolve',
            decision: 'always allow',
            interactionId: firstPending.id,
            controlToken: broker.controlToken,
        });
        const first = await firstAuthorization;

        assert.equal(first.status, 'approved');
        assert.equal(first.always, true);
        assert.equal(Object.hasOwn(first, 'approval'), false);

        const changedAuthorization = broker.handleRequest({
            type: 'bash.authorize',
            toolName: 'bash',
            params: { ...params, raw: `${params.raw} changed` },
        });
        const changedPending = await waitForPending(broker);
        await broker.handleRequest({
            type: 'approval.resolve',
            decision: 'deny',
            interactionId: changedPending.id,
            controlToken: broker.controlToken,
        });
        const changed = await changedAuthorization;
        assert.equal(changed.status, 'denied');
    } finally {
        fixture.cleanup();
    }
});

test('local Bash executor captures stdout only in its tool result', async () => {
    const fixture = createFixture();
    try {
        const executor = createBashExecutor({ cwd: fixture.workspace });
        const result = await executor({
            command: '/bin/cat',
            args: [fixture.insideFile],
            raw: `cat ${fixture.insideFile}`,
        });

        assert.equal(result.output, 'inside-visible');
        assert.equal(result.stderr, '');
    } finally {
        fixture.cleanup();
    }
});

function canCreateSandbox() {
    if (!bwrap) return false;
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-bwrap-probe-'));
    try {
        const result = spawnSync(bwrap, buildSandboxArgs({
            workspace,
            command: '/usr/bin/true',
        }), { cwd: workspace, encoding: 'utf8' });
        return result.status === 0;
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
}

function createFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-sandbox-test-'));
    const workspace = path.join(root, 'workspace');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(workspace);
    fs.mkdirSync(outside);
    const outsideFile = path.join(outside, 'secret.txt');
    const insideFile = path.join(workspace, 'visible.txt');
    fs.writeFileSync(outsideFile, 'outside-secret\n');
    fs.writeFileSync(insideFile, 'inside-visible\n');
    return {
        root,
        workspace,
        insideFile,
        outsideFile,
        cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    };
}

function createBufferedBroker(workspace, permissionMode) {
    return new AchillesBroker({
        workspace,
        webchat: true,
        permissionMode,
        stdout: { write() {} },
        stdin: { isTTY: false },
    });
}

async function runSandboxedBash(fixture, params) {
    const probeDir = fs.mkdtempSync(path.join(fixture.workspace, '.bash-executor-probe-'));
    const probePath = path.join(probeDir, 'probe.mjs');
    const resultPath = path.join(probeDir, 'result.json');
    fs.writeFileSync(probePath, [
        "import fs from 'node:fs';",
        `import { createBashExecutor } from ${JSON.stringify(localBashExecutorUrl)};`,
        'const executor = createBashExecutor({ cwd: process.cwd() });',
        'const result = await executor(JSON.parse(process.argv[2]));',
        'fs.writeFileSync(process.argv[3], JSON.stringify(result));',
    ].join('\n'));

    const exitCode = await runBrokeredMainAgent({
        workspace: fixture.workspace,
        argv: [JSON.stringify(params), resultPath],
        entryPath: probePath,
        webchat: false,
    });
    assert.equal(exitCode, 0);
    return JSON.parse(fs.readFileSync(resultPath, 'utf8'));
}

async function waitForPending(broker, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    while (!broker.pendingApproval) {
        if (Date.now() >= deadline) throw new Error('Timed out waiting for Bash approval.');
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return broker.pendingApproval;
}
