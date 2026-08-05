import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const HANDLE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RECORD_BYTES = 16 * 1024;
const RECORD_KEYS = Object.freeze([
    'createdAt',
    'projectDir',
    'provider',
    'threadId',
    'updatedAt',
    'version',
]);

function normalizeHomePath(value) {
    if (typeof value !== 'string' || value !== value.trim()) {
        throw new Error('continuation store requires an explicit runtime HOME that is canonical');
    }
    const homePath = value;
    if (!homePath || homePath === '/'
        || !path.isAbsolute(homePath)
        || path.normalize(homePath) !== homePath) {
        throw new Error('continuation store requires an explicit runtime HOME that is canonical');
    }
    return homePath;
}

function storeDirectoryFromHome(homePath) {
    return path.join(normalizeHomePath(homePath), '.ploinky', 'task-sessions');
}

function storeDirectory(env = process.env) {
    const configured = String(env.PLOINKY_CONTINUATION_STORE_DIR || '').trim();
    if (configured) {
        if (!path.isAbsolute(configured) || path.normalize(configured) !== configured) {
            throw new Error('continuation store directory must be an absolute canonical path');
        }
        return configured;
    }
    return storeDirectoryFromHome(env.HOME);
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

function assertSafeDirectory(directory) {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error('unsafe_continuation_store');
    }
}

function parseContinuationRecord(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('invalid_continuation_record');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
        || JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(RECORD_KEYS)
        || parsed.version !== 1 || parsed.provider !== 'codex'
        || typeof parsed.createdAt !== 'string' || parsed.createdAt !== parsed.createdAt.trim()
        || !parsed.createdAt
        || typeof parsed.updatedAt !== 'string' || parsed.updatedAt !== parsed.updatedAt.trim()
        || !parsed.updatedAt) {
        throw new Error('invalid_continuation_record');
    }
    const threadId = normalizeThreadId(parsed.threadId);
    if (!threadId) {
        throw new Error('invalid_continuation_record');
    }
    const projectDir = normalizeProjectDir(parsed.projectDir);
    return Object.freeze({ ...parsed, threadId, projectDir });
}

function readContinuationFile(filePath) {
    let descriptor;
    try {
        descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const stat = fs.fstatSync(descriptor);
        if (!stat.isFile() || stat.size < 1 || stat.size > MAX_RECORD_BYTES) {
            throw new Error('unsafe_continuation_record');
        }
        return parseContinuationRecord(fs.readFileSync(descriptor, 'utf8'));
    } catch (error) {
        if (error?.code === 'ELOOP') throw new Error('unsafe_continuation_record');
        throw error;
    } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
    }
}

function normalizeProjectDir(value) {
    if (typeof value !== 'string' || value !== value.trim()) {
        throw new Error('invalid_continuation_record');
    }
    const projectDir = value;
    if (!projectDir.startsWith('/workspace/')
        || projectDir.includes('\0')
        || path.posix.normalize(projectDir) !== projectDir) {
        throw new Error('invalid_continuation_record');
    }
    const relative = projectDir.slice('/workspace/'.length);
    if (!relative || relative.split('/').some((part) => !part || part === '.' || part === '..')) {
        throw new Error('invalid_continuation_record');
    }
    return projectDir;
}

function normalizeThreadId(value) {
    if (typeof value !== 'string' || value !== value.trim()
        || !value || value.includes('\0') || Buffer.byteLength(value, 'utf8') > 4096) {
        throw new Error('invalid_continuation_record');
    }
    return value;
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
    const threadId = normalizeThreadId(record?.threadId);
    const projectDir = normalizeProjectDir(record?.projectDir);
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
    return readContinuationFile(filePath);
}

/**
 * Read trusted continuation state from the exact HOME supplied by the runtime.
 * This path never consults process.env and never creates or repairs state.
 */
export function selectContinuationRecordFromHome(homePath, handle) {
    const normalizedHome = normalizeHomePath(homePath);
    const directory = storeDirectoryFromHome(normalizedHome);
    assertSafeDirectory(normalizedHome);
    assertSafeDirectory(path.join(normalizedHome, '.ploinky'));
    assertSafeDirectory(directory);
    const normalizedHandle = assertHandle(handle);
    const record = readContinuationFile(path.join(directory, `${normalizedHandle}.json`));
    return Object.freeze({
        handle: normalizedHandle,
        threadId: record.threadId,
        projectDir: record.projectDir,
    });
}

export function continuationDescriptor(handle) {
    return {
        version: 1,
        handle: assertHandle(handle),
        toolName: 'continue-task',
    };
}

export const __testables = {
    HANDLE_RE,
    MAX_RECORD_BYTES,
    assertHandle,
    normalizeHomePath,
    normalizeProjectDir,
    normalizeThreadId,
    parseContinuationRecord,
    storeDirectory,
    storeDirectoryFromHome,
};
