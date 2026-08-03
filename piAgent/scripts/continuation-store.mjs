import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const HANDLE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_STORE_DIRECTORY = '/root/.ploinky/task-sessions';
const DEFAULT_SESSION_DIRECTORY = '/root/.ploinky/pi-sessions';

function rootDirectory(env, key, fallback) {
    return path.resolve(env[key] || fallback);
}

function assertHandle(handle) {
    const normalized = String(handle || '').trim();
    if (!HANDLE_RE.test(normalized)) throw new Error('invalid_continuation_handle');
    return normalized;
}

function ensureDirectory(directory) {
    try {
        const stat = fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe_continuation_store');
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    return directory;
}

function storeDirectory(env = process.env) {
    return ensureDirectory(rootDirectory(env, 'PLOINKY_CONTINUATION_STORE_DIR', DEFAULT_STORE_DIRECTORY));
}

export function sessionDirectory(handle, env = process.env) {
    const root = ensureDirectory(rootDirectory(env, 'PLOINKY_PI_SESSION_DIR', DEFAULT_SESSION_DIRECTORY));
    const directory = path.join(root, assertHandle(handle));
    ensureDirectory(directory);
    return directory;
}

function existingSessionDirectory(handle, env = process.env) {
    const root = rootDirectory(env, 'PLOINKY_PI_SESSION_DIR', DEFAULT_SESSION_DIRECTORY);
    const directory = path.join(root, assertHandle(handle));
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe_pi_session_directory');
    return directory;
}

function existingStoreDirectory(env = process.env) {
    const directory = rootDirectory(env, 'PLOINKY_CONTINUATION_STORE_DIR', DEFAULT_STORE_DIRECTORY);
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe_continuation_store');
    return directory;
}

export function createContinuationHandle() {
    return crypto.randomUUID();
}

export function writeContinuationRecord(handle, record, env = process.env) {
    const normalized = assertHandle(handle);
    const filePath = path.join(storeDirectory(env), `${normalized}.json`);
    const rawProjectDir = String(record?.projectDir || '').trim();
    if (!rawProjectDir) throw new Error('invalid_continuation_record');
    const projectDir = path.resolve(rawProjectDir);
    if (!path.isAbsolute(projectDir)) throw new Error('invalid_continuation_record');
    const value = {
        version: 1,
        provider: 'pi',
        sessionId: normalized,
        sessionDir: sessionDirectory(normalized, env),
        projectDir,
        createdAt: String(record?.createdAt || new Date().toISOString()),
        updatedAt: new Date().toISOString(),
    };
    const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
        fs.writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
        fs.renameSync(temporaryPath, filePath);
    } finally {
        try { fs.unlinkSync(temporaryPath); } catch (_) { }
    }
    return value;
}

export function readContinuationRecord(handle, env = process.env) {
    const normalized = assertHandle(handle);
    const filePath = path.join(existingStoreDirectory(env), `${normalized}.json`);
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe_continuation_record');
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed?.version !== 1 || parsed?.provider !== 'pi' || parsed?.sessionId !== normalized) {
        throw new Error('invalid_continuation_record');
    }
    const rawProjectDir = String(parsed.projectDir || '').trim();
    if (!rawProjectDir) throw new Error('invalid_continuation_record');
    return {
        ...parsed,
        projectDir: path.resolve(rawProjectDir),
        sessionDir: existingSessionDirectory(normalized, env),
    };
}

export function continuationDescriptor(handle) {
    return {
        version: 1,
        handle: assertHandle(handle),
        toolName: 'continue-task',
    };
}

export const __testables = { HANDLE_RE, assertHandle };
