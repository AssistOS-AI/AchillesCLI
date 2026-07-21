import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
    APPROVAL_DECISIONS,
    buildApprovalKey,
    createWebchatApprovalInteraction,
    createWebchatInteractionResolved,
    formatApprovalPrompt,
    normalizeApprovalDecision,
    normalizePermissionMode,
    PERMISSION_MODES,
} from '../permissions/protocol.mjs';
import {
    buildSandboxArgs,
    collectMainAgentRuntimeMounts,
    executeProcess,
    findBubblewrap,
    isLikelySandboxDenial,
} from './sandbox.mjs';

const DEFAULT_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

export class AchillesBroker {
    constructor({
        workspace,
        webchat = false,
        permissionMode = PERMISSION_MODES.ASK,
        stdout = process.stdout,
        stderr = process.stderr,
        stdin = process.stdin,
        env = process.env,
        approvalTimeoutMs = DEFAULT_APPROVAL_TIMEOUT_MS,
    } = {}) {
        this.workspace = fs.realpathSync(workspace);
        this.webchat = webchat;
        this.permissionMode = normalizePermissionMode(permissionMode) || PERMISSION_MODES.ASK;
        this.stdout = stdout;
        this.stderr = stderr;
        this.stdin = stdin;
        this.env = env;
        this.approvalTimeoutMs = Math.max(1000, Number(approvalTimeoutMs) || DEFAULT_APPROVAL_TIMEOUT_MS);
        this.pendingApproval = null;
        this.approvalTokens = new Map();
        this.controlToken = randomUUID();
        this.server = null;
        this.socketDir = null;
        this.socketPath = null;
    }

    async startServer() {
        this.socketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-broker-'));
        this.socketPath = path.join(this.socketDir, 'broker.sock');
        fs.writeFileSync(path.join(this.socketDir, 'control-token'), this.controlToken, { mode: 0o600 });
        this.server = net.createServer({ allowHalfOpen: true }, (socket) => this._handleSocket(socket));
        await new Promise((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(this.socketPath, () => {
                this.server.removeListener('error', reject);
                resolve();
            });
        });
        return this.socketPath;
    }

    async close() {
        this._settlePending(APPROVAL_DECISIONS.DENY, 'cancelled');
        if (this.server) {
            await new Promise((resolve) => this.server.close(resolve));
            this.server = null;
        }
        if (this.socketDir) {
            fs.rmSync(this.socketDir, { recursive: true, force: true });
            this.socketDir = null;
        }
        this.approvalTokens.clear();
    }

    async handleRequest(request = {}) {
        switch (request.type) {
            case 'permissions.get':
                return { ok: true, mode: this.permissionMode };
            case 'permissions.set':
                return this._setPermissionMode(request.mode, request.controlToken);
            case 'bash.authorize':
                return this._authorizeBash(request);
            case 'bash.execute':
                return this._executeBash(request);
            case 'approval.pending':
                return {
                    ok: true,
                    pending: Boolean(this.pendingApproval),
                    interactionId: this.pendingApproval?.id || null,
                    prompt: this.pendingApproval?.prompt || null,
                };
            case 'approval.resolve':
                return this._resolvePending(request.decision, request.interactionId, request.controlToken);
            default:
                return { ok: false, error: `Unknown broker request: ${request.type || '(missing)'}` };
        }
    }

    _setPermissionMode(value, controlToken) {
        if (!controlToken || controlToken !== this.controlToken) {
            return { ok: false, error: 'Permission mode changes require the trusted CLI control channel.' };
        }
        const mode = normalizePermissionMode(value);
        if (!mode) {
            return {
                ok: false,
                error: `Unknown permission mode. Use ${PERMISSION_MODES.ASK} or ${PERMISSION_MODES.FULL}.`,
            };
        }
        this._settlePending(APPROVAL_DECISIONS.DENY, 'cancelled');
        this.permissionMode = mode;
        return { ok: true, mode };
    }

    async _authorizeBash(request) {
        const params = normalizeCommandParams(request.params);
        if (!params.command && !params.raw) {
            return { ok: true, status: 'denied', reason: 'No Bash command was provided.' };
        }
        if (this.permissionMode === PERMISSION_MODES.FULL) {
            return { ok: true, status: 'approved' };
        }
        const existing = this._validateApproval(request.approval, 'bash', params);
        if (existing) {
            return { ok: true, status: 'approved', always: existing.always, approval: request.approval };
        }
        return this._requestApproval({ toolName: 'bash', params, phase: 'authorize', escalation: false });
    }

    async _executeBash(request) {
        const params = normalizeCommandParams(request.params);
        if (!params.command) {
            return { ok: true, status: 'denied', result: deniedResult('No executable Bash command was provided.') };
        }

        const approved = this._validateApproval(request.approval, 'bash', params);
        if (approved) {
            if (!approved.always) this.approvalTokens.delete(request.approval.token);
            return this._executeOutside(params, request.approval);
        }

        if (this.permissionMode === PERMISSION_MODES.ASK) {
            const approval = await this._requestApproval({
                toolName: 'bash',
                params,
                phase: 'execute',
                escalation: false,
            });
            if (approval.status !== 'approved') {
                return {
                    ...approval,
                    result: deniedResult(approval.reason),
                };
            }
            return this._executeOutside(params, approval.approval);
        }

        const sandboxResult = await this._executeInWorkspace(params);
        if (!isLikelySandboxDenial(sandboxResult)) {
            return { ok: true, status: 'completed', result: normalizeExecutionResult(sandboxResult) };
        }

        const approval = await this._requestApproval({
            toolName: 'bash',
            params,
            phase: 'escalate',
            escalation: true,
            sandboxResult,
        });
        if (approval.status !== 'approved') {
            return {
                ...approval,
                result: deniedResult(approval.reason, false, sandboxResult),
            };
        }
        return this._executeOutside(params, approval.approval);
    }

    async _requestApproval({ toolName, params, phase, escalation, sandboxResult = null }) {
        const prompt = formatApprovalPrompt({ params, escalation });
        if (this.webchat || !this.stdin?.isTTY) {
            if (this.pendingApproval) {
                return {
                    ok: true,
                    status: 'denied',
                    reason: 'Another Bash approval is already waiting for the user.',
                };
            }
            const id = randomUUID();
            const interaction = createWebchatApprovalInteraction({ id, params, escalation });
            const settled = await new Promise((resolve) => {
                const timer = setTimeout(() => {
                    this._settlePending(APPROVAL_DECISIONS.DENY, 'expired');
                }, this.approvalTimeoutMs);
                timer.unref?.();
                this.pendingApproval = {
                    id,
                    toolName,
                    params,
                    phase,
                    escalation,
                    sandboxResult,
                    prompt,
                    timer,
                    resolve,
                };
                this.stdout.write(`${JSON.stringify(interaction)}\n`);
            });
            if (settled.decision === APPROVAL_DECISIONS.DENY) {
                const reason = settled.status === 'expired'
                    ? 'Bash approval expired. The Bash command was not executed.'
                    : 'The user denied this Bash command. It was not executed.';
                return { ok: true, status: 'denied', reason };
            }
            const approval = this._issueApproval(
                toolName,
                params,
                settled.decision === APPROVAL_DECISIONS.ALWAYS_ALLOW,
            );
            return { ok: true, status: 'approved', always: approval.always, approval };
        }

        const decision = await readTerminalDecision(prompt);
        if (decision === APPROVAL_DECISIONS.DENY || !decision) {
            return {
                ok: true,
                status: 'denied',
                reason: 'The user denied this Bash command. It was not executed.',
            };
        }
        const approval = this._issueApproval(toolName, params, decision === APPROVAL_DECISIONS.ALWAYS_ALLOW);
        return { ok: true, status: 'approved', always: approval.always, approval };
    }

    async _resolvePending(value, interactionId, controlToken) {
        if (!controlToken || controlToken !== this.controlToken) {
            return { ok: false, error: 'Approval decisions require the trusted CLI control channel.' };
        }
        if (!this.pendingApproval) {
            return { ok: true, status: 'none', reason: 'There is no pending Bash approval.' };
        }
        if (!interactionId || interactionId !== this.pendingApproval.id) {
            return { ok: true, status: 'stale', reason: 'The Bash approval request is no longer active.' };
        }
        const decision = normalizeApprovalDecision(value);
        if (!decision) {
            return { ok: true, status: 'invalid', prompt: this.pendingApproval.prompt };
        }
        const id = this.pendingApproval.id;
        this._settlePending(decision, 'resolved');
        return { ok: true, status: 'resolved', interactionId: id, decision };
    }

    _settlePending(decision, status) {
        const pending = this.pendingApproval;
        if (!pending) return false;
        this.pendingApproval = null;
        clearTimeout(pending.timer);
        if (this.webchat || !this.stdin?.isTTY) {
            const optionId = decision === APPROVAL_DECISIONS.ALWAYS_ALLOW ? 'always-allow' : decision;
            this.stdout.write(`${JSON.stringify(createWebchatInteractionResolved({
                id: pending.id,
                optionId,
                status,
            }))}\n`);
        }
        pending.resolve({ decision, status });
        return true;
    }

    _issueApproval(toolName, params, always) {
        const key = buildApprovalKey(toolName, canonicalApprovalParams(params));
        const approval = { token: randomUUID(), key, always: Boolean(always) };
        this.approvalTokens.set(approval.token, approval);
        return approval;
    }

    _validateApproval(approval, toolName, params) {
        if (!approval?.token) return null;
        const stored = this.approvalTokens.get(approval.token);
        const expectedKey = buildApprovalKey(toolName, canonicalApprovalParams(params));
        if (!stored || stored.key !== expectedKey || approval.key !== expectedKey) return null;
        return stored;
    }

    async _executeInWorkspace(params) {
        const bwrap = findBubblewrap();
        if (!bwrap) {
            return { success: false, error: 'bubblewrap is not installed.', stderr: '', stdout: '', status: null };
        }
        return executeProcess({
            command: bwrap,
            args: buildSandboxArgs({
                workspace: this.workspace,
                command: params.command,
                args: params.args,
            }),
            cwd: this.workspace,
            env: this.env,
        });
    }

    async _executeOutside(params, approval) {
        const execution = await executeProcess({
            command: params.command,
            args: params.args,
            cwd: this.workspace,
            env: this.env,
        });
        return {
            ok: true,
            status: 'completed',
            approval: approval?.always ? approval : null,
            command: params.raw,
            result: {
                ...normalizeExecutionResult(execution),
            },
        };
    }

    _handleSocket(socket) {
        socket.setEncoding('utf8');
        socket.on('error', () => {
            // A disconnected client must not crash the long-lived Broker.
        });
        let buffer = '';
        socket.on('data', (chunk) => {
            buffer += chunk;
        });
        socket.once('end', async () => {
            let response;
            try {
                response = await this.handleRequest(JSON.parse(buffer.trim()));
            } catch (error) {
                response = { ok: false, error: error.message };
            }
            socket.end(`${JSON.stringify(response)}\n`);
        });
    }
}

export async function runBrokeredMainAgent({
    workspace,
    argv = process.argv.slice(2),
    entryPath = process.argv[1],
    webchat = false,
    permissionMode = PERMISSION_MODES.ASK,
    extraReadOnlyPaths = [],
} = {}) {
    const bwrap = findBubblewrap();
    if (!bwrap) {
        throw new Error('AchillesCLI requires bubblewrap (bwrap). Run the agent install hook before starting it.');
    }
    const broker = new AchillesBroker({ workspace, webchat, permissionMode });
    await broker.startServer();
    const childEnv = {
        ...process.env,
        ACHILLES_BROKER_CHILD: '1',
        ACHILLES_BROKER_SOCKET: broker.socketPath,
        ACHILLES_WORKSPACE: broker.workspace,
    };
    const runtimeMounts = collectMainAgentRuntimeMounts({
        entryPath,
        extraPaths: extraReadOnlyPaths,
    }).filter((mountPath) => !isInside(mountPath, broker.workspace));
    const sandboxArgs = buildSandboxArgs({
        workspace: broker.workspace,
        socketDir: broker.socketDir,
        command: process.execPath,
        args: [entryPath, ...argv],
        extraReadOnlyPaths: runtimeMounts,
    });

    const exitCode = await new Promise((resolve, reject) => {
        const child = spawn(bwrap, sandboxArgs, {
            cwd: broker.workspace,
            env: childEnv,
            stdio: 'inherit',
        });
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    }).finally(() => broker.close());
    return exitCode;
}

function normalizeCommandParams(value = {}) {
    return {
        command: String(value.command || '').trim(),
        args: Array.isArray(value.args) ? value.args.map(String) : [],
        raw: String(value.raw || value.command || '').trim(),
    };
}

function canonicalApprovalParams(params) {
    return normalizeCommandParams(params);
}

function normalizeExecutionResult(result) {
    return {
        success: Boolean(result.success),
        output: String(result.stdout || '').trim(),
        stderr: String(result.stderr || '').trim(),
        error: result.error || null,
        exitCode: result.status,
        signal: result.signal || null,
        timedOut: Boolean(result.timedOut),
    };
}

function deniedResult(reason, pending = false, sandboxResult = null) {
    return {
        success: false,
        denied: !pending,
        pending,
        error: reason || 'Bash execution was denied.',
        ...(sandboxResult ? { sandboxResult: normalizeExecutionResult(sandboxResult) } : {}),
    };
}

function readTerminalDecision(prompt) {
    return new Promise((resolve) => {
        const input = fs.createReadStream('/dev/tty');
        const output = fs.createWriteStream('/dev/tty');
        const rl = readline.createInterface({ input, output });
        rl.question(`${prompt}\n> `, (answer) => {
            const decision = normalizeApprovalDecision(answer);
            rl.close();
            input.destroy();
            output.end();
            resolve(decision);
        });
    });
}

function isInside(candidate, root) {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
