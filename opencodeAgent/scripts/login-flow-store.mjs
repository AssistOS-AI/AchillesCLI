import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';

const FLOW_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_ROOT = '/root/.ploinky/login-flows';
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

function rootDirectory(env = process.env) {
    return path.resolve(env.PLOINKY_LOGIN_FLOW_DIR || DEFAULT_ROOT);
}

function ensureRoot(env = process.env) {
    const root = rootDirectory(env);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe_login_flow_store');
    return root;
}

function assertFlowId(flowId) {
    const normalized = String(flowId || '').trim();
    if (!FLOW_RE.test(normalized)) throw new Error('invalid_login_flow_id');
    return normalized;
}

function paths(flowId, env = process.env) {
    const id = assertFlowId(flowId);
    const root = ensureRoot(env);
    return { state: path.join(root, `${id}.json`), socket: path.join(root, `${id}.sock`) };
}

function atomicWrite(filePath, value) {
    const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
        fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
        fs.renameSync(temporary, filePath);
    } finally {
        try { fs.unlinkSync(temporary); } catch (_) { }
    }
}

export function createLoginFlow({ provider, method, workerPath, workerArgs = [], env = process.env }) {
    const flowId = crypto.randomUUID();
    const now = new Date().toISOString();
    atomicWrite(paths(flowId, env).state, {
        version: 1,
        flowId,
        provider: String(provider || ''),
        method: String(method || ''),
        status: 'running',
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + DEFAULT_TIMEOUT_MS).toISOString(),
    });
    const child = spawn(process.execPath, [workerPath, flowId, ...workerArgs], {
        env: { ...process.env, ...env },
        detached: true,
        stdio: 'ignore',
    });
    child.unref();
    updateLoginFlow(flowId, { pid: child.pid }, env);
    return readLoginFlow(flowId, env);
}

export function readLoginFlow(flowId, env = process.env) {
    const parsed = JSON.parse(fs.readFileSync(paths(flowId, env).state, 'utf8'));
    if (parsed?.version !== 1 || parsed?.flowId !== assertFlowId(flowId)) throw new Error('invalid_login_flow');
    if (!['completed', 'failed', 'cancelled'].includes(parsed.status)
        && Date.parse(parsed.expiresAt || '') <= Date.now()) return cancelLoginFlow(flowId, env, 'expired');
    const { pid: _pid, ...publicState } = parsed;
    return publicState;
}

export function updateLoginFlow(flowId, patch, env = process.env) {
    const filePath = paths(flowId, env).state;
    const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const updated = {
        ...existing,
        ...patch,
        version: 1,
        flowId: assertFlowId(flowId),
        updatedAt: new Date().toISOString(),
    };
    atomicWrite(filePath, updated);
    const { pid: _pid, ...publicState } = updated;
    return publicState;
}

export async function respondToLoginFlow(flowId, response, env = process.env) {
    if (readLoginFlow(flowId, env).status !== 'waiting') throw new Error('login_flow_not_waiting');
    const socketPath = paths(flowId, env).socket;
    const deadline = Date.now() + 5000;
    while (true) {
        try {
            await new Promise((resolve, reject) => {
                const socket = net.createConnection(socketPath);
                socket.once('error', reject);
                socket.once('connect', () => socket.end(String(response || ''), resolve));
            });
            break;
        } catch (error) {
            if (Date.now() >= deadline) throw error;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    const deliveredBy = Date.now() + 1000;
    let delivered = readLoginFlow(flowId, env);
    while (delivered.status === 'waiting' && Date.now() < deliveredBy) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        delivered = readLoginFlow(flowId, env);
    }
    return delivered;
}

export async function waitForLoginResponse(flowId, { signal, env = process.env } = {}) {
    const socketPath = paths(flowId, env).socket;
    try { fs.unlinkSync(socketPath); } catch (_) { }
    return new Promise((resolve, reject) => {
        let settled = false;
        const server = net.createServer((socket) => {
            let value = '';
            socket.setEncoding('utf8');
            socket.on('data', (chunk) => { value = `${value}${chunk}`.slice(0, 65536); });
            socket.on('end', () => finish(null, value));
        });
        const abort = () => finish(new Error('login_cancelled'));
        const finish = (error, value = '') => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener?.('abort', abort);
            try { server.close(() => { try { fs.unlinkSync(socketPath); } catch (_) { } }); }
            catch (_) { try { fs.unlinkSync(socketPath); } catch (_) { } }
            if (error) reject(error);
            else {
                updateLoginFlow(flowId, { status: 'running', prompt: null }, env);
                resolve(value);
            }
        };
        server.once('error', (error) => finish(error));
        server.listen(socketPath, () => {
            fs.chmodSync(socketPath, 0o600);
            if (signal?.aborted) abort();
            else signal?.addEventListener?.('abort', abort, { once: true });
        });
    });
}

export function cancelLoginFlow(flowId, env = process.env, reason = 'cancelled') {
    const existing = JSON.parse(fs.readFileSync(paths(flowId, env).state, 'utf8'));
    if (Number.isInteger(existing.pid) && existing.pid > 1) {
        try { process.kill(existing.pid, 'SIGTERM'); } catch (_) { }
    }
    try { fs.unlinkSync(paths(flowId, env).socket); } catch (_) { }
    return updateLoginFlow(flowId, { status: 'cancelled', reason, prompt: null }, env);
}

export const __testables = { FLOW_RE, DEFAULT_TIMEOUT_MS, rootDirectory };

