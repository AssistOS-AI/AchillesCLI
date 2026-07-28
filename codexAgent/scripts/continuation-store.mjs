import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const HANDLE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_STORE_DIRECTORY = '/root/.ploinky/task-sessions';

function storeDirectory(env = process.env) {
    return path.resolve(env.PLOINKY_CONTINUATION_STORE_DIR || DEFAULT_STORE_DIRECTORY);
}

function assertHandle(handle) {
    const normalized = String(handle || '').trim();
    if (!HANDLE_RE.test(normalized)) throw new Error('invalid_continuation_handle');
    return normalized;
}

function assertRegularFileOrMissing(filePath) {
    try {
        const stat = fs.lstatSync(filePath);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe_continuation_record');
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
}

function ensureStore(env = process.env) {
    const directory = storeDirectory(env);
    try {
        const stat = fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe_continuation_store');
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    }
    return directory;
}

function recordPath(handle, env = process.env) {
    return path.join(ensureStore(env), `${assertHandle(handle)}.json`);
}

export function createContinuationHandle() {
    return crypto.randomUUID();
}

export function writeContinuationRecord(handle, record, env = process.env) {
    const filePath = recordPath(handle, env);
    assertRegularFileOrMissing(filePath);
    const threadId = String(record?.threadId || '').trim();
    const rawProjectDir = String(record?.projectDir || '').trim();
    if (!threadId || !rawProjectDir) throw new Error('invalid_continuation_record');
    const projectDir = path.resolve(rawProjectDir);
    if (!path.isAbsolute(projectDir)) throw new Error('invalid_continuation_record');
    const value = {
        version: 1,
        provider: 'codex',
        threadId,
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
    const filePath = recordPath(handle, env);
    assertRegularFileOrMissing(filePath);
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (parsed?.version !== 1 || parsed?.provider !== 'codex') {
        throw new Error('invalid_continuation_record');
    }
    const threadId = String(parsed.threadId || '').trim();
    const rawProjectDir = String(parsed.projectDir || '').trim();
    if (!threadId || !rawProjectDir) throw new Error('invalid_continuation_record');
    const projectDir = path.resolve(rawProjectDir);
    if (!path.isAbsolute(projectDir)) throw new Error('invalid_continuation_record');
    return { ...parsed, threadId, projectDir };
}

export function continuationDescriptor(handle) {
    return {
        version: 1,
        handle: assertHandle(handle),
        toolName: 'continue-task',
    };
}

export const __testables = { HANDLE_RE, assertHandle, storeDirectory };
