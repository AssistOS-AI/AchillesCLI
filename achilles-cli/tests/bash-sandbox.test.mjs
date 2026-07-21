import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { AchillesBroker, runBrokeredMainAgent } from '../src/broker/AchillesBroker.mjs';
import { buildSandboxArgs, canMountPrivateProc, findBubblewrap } from '../src/broker/sandbox.mjs';
import { BrokerClient } from '../src/permissions/BrokerClient.mjs';
import { action as runBashSkill } from '../src/skills/bash/src/index.mjs';
import {
    createWebchatApprovalInteraction,
    parseWebchatInteractionResponse,
    PERMISSION_MODES,
} from '../src/permissions/protocol.mjs';

const bwrap = findBubblewrap();
const sandboxAvailable = canCreateSandbox();

test('Bash skill contains execution only and delegates structured params', async () => {
    const calls = [];
    const result = await runBashSkill({
        promptText: 'printf hello',
        bashExecutor: async (params, options) => {
            calls.push({ params, options });
            return { success: true, output: 'hello' };
        },
        supervisorApproval: { token: 'approved' },
    });

    assert.equal(result, 'hello');
    assert.deepEqual(calls, [{
        params: { command: 'printf', args: ['hello'], raw: 'printf hello' },
        options: { supervisorApproval: { token: 'approved' } },
    }]);
});

test('Bash skill fails closed when the Broker executor is unavailable', async () => {
    const result = await runBashSkill({ promptText: 'echo hello' });
    assert.match(result, /Broker is unavailable/i);
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

test('private proc capability probe returns a boolean', () => {
    assert.equal(typeof canMountPrivateProc(bwrap), 'boolean');
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

        const executed = await client.execute('bash', params, approved.approval);
        assert.equal(executed.status, 'completed');
        assert.equal(executed.result.output, 'approved');
        assert.equal(Object.hasOwn(executed.result, 'userApproved'), false);
    } finally {
        await broker.close();
        fixture.cleanup();
    }
});

test('workspace sandbox allows writes inside the selected workspace', { skip: !sandboxAvailable }, async () => {
    const fixture = createFixture();
    try {
        const broker = createBufferedBroker(fixture.workspace, PERMISSION_MODES.FULL);
        const response = await broker.handleRequest({
            type: 'bash.execute',
            toolName: 'bash',
            params: {
                command: '/usr/bin/touch',
                args: [path.join(fixture.workspace, 'created.txt')],
                raw: `touch ${path.join(fixture.workspace, 'created.txt')}`,
            },
        });

        assert.equal(response.status, 'completed');
        assert.equal(response.result.success, true);
        assert.equal(Object.hasOwn(response.result, 'userApproved'), false);
        assert.equal(fs.existsSync(path.join(fixture.workspace, 'created.txt')), true);
    } finally {
        fixture.cleanup();
    }
});

test('persistent MainAgent sandbox cannot read a sibling outside the workspace', { skip: !sandboxAvailable }, async () => {
    const fixture = createFixture();
    try {
        const probePath = path.join(fixture.workspace, 'sandbox-probe.mjs');
        const resultPath = path.join(fixture.workspace, 'probe-result.txt');
        fs.writeFileSync(probePath, [
            "import fs from 'node:fs';",
            'try {',
            '    fs.readFileSync(process.argv[2], \'utf8\');',
            '    fs.writeFileSync(process.argv[3], \'outside-visible\');',
            '    process.exitCode = 2;',
            '} catch {',
            '    fs.writeFileSync(process.argv[3], \'outside-blocked\');',
            '}',
        ].join('\n'));

        const exitCode = await runBrokeredMainAgent({
            workspace: fixture.workspace,
            argv: [fixture.outsideFile, resultPath],
            entryPath: probePath,
            webchat: false,
        });

        assert.equal(exitCode, 0);
        assert.equal(fs.readFileSync(resultPath, 'utf8'), 'outside-blocked');
    } finally {
        fixture.cleanup();
    }
});

test('workspace sandbox blocks an outside path and retries only after approval', { skip: !sandboxAvailable }, async () => {
    const fixture = createFixture();
    try {
        const broker = createBufferedBroker(fixture.workspace, PERMISSION_MODES.FULL);
        const params = {
            command: '/usr/bin/cat',
            args: [fixture.outsideFile],
            raw: `cat ${fixture.outsideFile}`,
        };
        const execution = broker.handleRequest({ type: 'bash.execute', toolName: 'bash', params });
        const pending = await waitForPending(broker);

        assert.equal(pending.escalation, true);
        assert.match(pending.sandboxResult.error || pending.sandboxResult.stderr, /No such file|Permission denied/i);

        const resolution = await broker.handleRequest({
            type: 'approval.resolve',
            decision: 'allow',
            interactionId: pending.id,
            controlToken: broker.controlToken,
        });
        assert.equal(resolution.status, 'resolved');
        const approved = await execution;
        assert.equal(approved.status, 'completed');
        assert.equal(approved.result.success, true);
        assert.equal(approved.result.output, 'outside-secret');
        assert.equal(Object.hasOwn(approved.result, 'userApproved'), false);
    } finally {
        fixture.cleanup();
    }
});

test('ask-for-approval does not execute Bash before a decision', async () => {
    const fixture = createFixture();
    try {
        const broker = createBufferedBroker(fixture.workspace, PERMISSION_MODES.ASK);
        const target = path.join(fixture.workspace, 'must-not-exist.txt');
        const execution = broker.handleRequest({
            type: 'bash.execute',
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
        const denied = await execution;
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
        const execution = broker.handleRequest({
            type: 'bash.execute',
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
        await execution;
    } finally {
        fixture.cleanup();
    }
});

test('always allow proof is valid only for the exact Bash params', async () => {
    const fixture = createFixture();
    try {
        const broker = createBufferedBroker(fixture.workspace, PERMISSION_MODES.ASK);
        const params = { command: '/usr/bin/cat', args: [fixture.outsideFile], raw: `cat ${fixture.outsideFile}` };
        const firstExecution = broker.handleRequest({ type: 'bash.execute', toolName: 'bash', params });
        const firstPending = await waitForPending(broker);
        await broker.handleRequest({
            type: 'approval.resolve',
            decision: 'always allow',
            interactionId: firstPending.id,
            controlToken: broker.controlToken,
        });
        const first = await firstExecution;

        assert.equal(first.result.success, true);
        assert.equal(Object.hasOwn(first.result, 'userApproved'), false);
        assert.equal(first.approval.always, true);

        const repeated = await broker.handleRequest({
            type: 'bash.execute',
            toolName: 'bash',
            params,
            approval: first.approval,
        });
        assert.equal(repeated.status, 'completed');
        assert.equal(repeated.result.output, 'outside-secret');
        assert.equal(Object.hasOwn(repeated.result, 'userApproved'), false);

        const changedExecution = broker.handleRequest({
            type: 'bash.execute',
            toolName: 'bash',
            params: { ...params, raw: `${params.raw} changed` },
            approval: first.approval,
        });
        const changedPending = await waitForPending(broker);
        await broker.handleRequest({
            type: 'approval.resolve',
            decision: 'deny',
            interactionId: changedPending.id,
            controlToken: broker.controlToken,
        });
        const changed = await changedExecution;
        assert.equal(changed.status, 'denied');
    } finally {
        fixture.cleanup();
    }
});

test('Bash executor returns stdout only through the tool result', async () => {
    const fixture = createFixture();
    try {
        const liveChunks = [];
        const broker = new AchillesBroker({
            workspace: fixture.workspace,
            webchat: true,
            permissionMode: PERMISSION_MODES.ASK,
            stdout: { write: (chunk) => liveChunks.push(String(chunk)) },
            stderr: { write() {} },
            stdin: { isTTY: false },
        });
        const params = { command: '/usr/bin/cat', args: [fixture.outsideFile], raw: `cat ${fixture.outsideFile}` };
        const execution = broker.handleRequest({ type: 'bash.execute', toolName: 'bash', params });
        const pending = await waitForPending(broker);
        liveChunks.length = 0;

        await broker.handleRequest({
            type: 'approval.resolve',
            decision: 'allow',
            interactionId: pending.id,
            controlToken: broker.controlToken,
        });
        const approved = await execution;

        assert.equal(approved.result.output, 'outside-secret');
        assert.doesNotMatch(liveChunks.join(''), /outside-secret/);
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
    fs.writeFileSync(outsideFile, 'outside-secret\n');
    return {
        root,
        workspace,
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
        stderr: { write() {} },
        stdin: { isTTY: false },
    });
}

async function waitForPending(broker, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    while (!broker.pendingApproval) {
        if (Date.now() >= deadline) throw new Error('Timed out waiting for Bash approval.');
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return broker.pendingApproval;
}
