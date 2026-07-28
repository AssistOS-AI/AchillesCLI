import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AchillesBroker } from '../src/broker/AchillesBroker.mjs';
import {
    CLI_APPROVAL_OPTIONS,
    CliApprovalController,
} from '../src/permissions/CliApprovalController.mjs';

async function waitFor(check, timeoutMs = 1000) {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
        if (Date.now() >= deadline) throw new Error('Timed out waiting for condition.');
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

test('CLI approval uses an arrow-key selector and restores the active input owner', async () => {
    const calls = [];
    let pending = true;
    let renderedOptions = null;
    let renderedConfig = null;
    let output = '';
    const client = {
        getPendingApproval: async () => pending
            ? {
                pending: true,
                interactionId: 'approval_12345678',
                prompt: 'Bash approval required\n$ git status\nReply with: allow, deny, or always allow.',
            }
            : { pending: false },
        resolvePendingApproval: async (decision, interactionId) => {
            calls.push(['resolve', decision, interactionId]);
            pending = false;
        },
    };
    const controller = new CliApprovalController({
        approvalControlClient: client,
        selector: async (options, config) => {
            renderedOptions = options;
            renderedConfig = config;
            return options[0];
        },
        output: { write: (value) => { output += value; } },
        pollIntervalMs: 5,
    });

    const monitor = controller.start({
        pause: () => calls.push(['pause']),
        resume: () => calls.push(['resume']),
        suspendInput: () => calls.push(['suspend']),
        restoreInput: () => calls.push(['restore']),
    });
    await waitFor(() => !pending);
    await monitor.stop();

    assert.deepEqual(renderedOptions.map((option) => option.name), [
        'Always allow',
        'Allow',
        'Deny',
    ]);
    assert.equal(renderedConfig.prompt, 'Permission> ');
    assert.match(output, /\$ git status/);
    assert.doesNotMatch(output, /Reply with:/);
    assert.deepEqual(calls, [
        ['pause'],
        ['suspend'],
        ['resolve', 'always allow', 'approval_12345678'],
        ['restore'],
        ['resume'],
    ]);
});

test('cancelling the CLI approval selector fails closed', async () => {
    let pending = true;
    let resolvedDecision = null;
    const controller = new CliApprovalController({
        approvalControlClient: {
            getPendingApproval: async () => pending
                ? { pending: true, interactionId: 'approval_abcdefgh', prompt: 'Approve?' }
                : { pending: false },
            resolvePendingApproval: async (decision) => {
                resolvedDecision = decision;
                pending = false;
            },
        },
        selector: async () => null,
        output: { write() {} },
        pollIntervalMs: 5,
    });

    const monitor = controller.start();
    await waitFor(() => !pending);
    await monitor.stop();
    assert.equal(resolvedDecision, 'deny');
});

test('client-managed Broker approvals do not compete for or write to the terminal', async (t) => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-cli-approval-'));
    t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
    let terminalOutput = '';
    const broker = new AchillesBroker({
        workspace,
        webchat: false,
        clientManagedApprovals: true,
        stdin: { isTTY: true },
        stdout: { write: (value) => { terminalOutput += value; } },
    });

    const authorization = broker.handleRequest({
        type: 'bash.authorize',
        toolName: 'bash',
        params: { command: 'git', args: ['status'], raw: 'git status' },
    });
    await waitFor(() => Boolean(broker.pendingApproval));
    const interactionId = broker.pendingApproval.id;
    await broker.handleRequest({
        type: 'approval.resolve',
        decision: 'allow',
        interactionId,
        controlToken: broker.controlToken,
    });

    assert.deepEqual(await authorization, {
        ok: true,
        status: 'approved',
        always: false,
    });
    assert.equal(terminalOutput, '');
});

test('approval choices keep Always allow as the default first item', () => {
    assert.deepEqual(CLI_APPROVAL_OPTIONS.map((option) => option.value), [
        'always allow',
        'allow',
        'deny',
    ]);
});
