import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const HANDLE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORE_DIRECTORY = '/home/agent/.ploinky/task-sessions';
const SESSION_DIRECTORY = '/home/agent/.ploinky/pi-sessions';
const DIRECTORY_OPEN_FLAGS = fs.constants.O_RDONLY
    | fs.constants.O_DIRECTORY
    | fs.constants.O_NOFOLLOW
    | (fs.constants.O_CLOEXEC || 0);
const FILE_READ_FLAGS = fs.constants.O_RDONLY
    | fs.constants.O_NOFOLLOW
    | (fs.constants.O_CLOEXEC || 0);
const FILE_WRITE_FLAGS = fs.constants.O_WRONLY
    | fs.constants.O_CREAT
    | fs.constants.O_EXCL
    | fs.constants.O_NOFOLLOW
    | (fs.constants.O_CLOEXEC || 0);

function assertHandle(handle) {
    const normalized = String(handle || '').trim();
    if (!HANDLE_RE.test(normalized)) throw new Error('invalid_continuation_handle');
    return normalized;
}

function assertRoot(directory, label) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)
        || path.resolve(directory) !== directory || directory === path.parse(directory).root) {
        throw new Error(`invalid_${label}`);
    }
    return directory;
}

function assertBeneath(homeRoot, directory, label) {
    const relative = path.relative(homeRoot, directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`invalid_${label}`);
    }
    return relative;
}

function stateError(code, cause) {
    const error = new Error(code, cause ? { cause } : undefined);
    error.code = code;
    return error;
}

function assertLeafName(name) {
    if (typeof name !== 'string' || !name || name === '.' || name === '..'
        || name.includes('/') || name.includes('\0')) {
        throw stateError('invalid_continuation_record');
    }
    return name;
}

function retainedPath(directoryFd, leaf = '') {
    if (process.platform !== 'linux') {
        throw stateError('PLOINKY_RETAINED_FD_UNAVAILABLE');
    }
    const root = `/proc/self/fd/${directoryFd}`;
    return leaf ? `${root}/${assertLeafName(leaf)}` : root;
}

function createRetainedFilesystem(homeRoot, {
    afterDirectoryOpen,
    beforeRename,
} = {}) {
    const fixedHomeRoot = assertRoot(homeRoot, 'provider_home');
    for (const callback of [afterDirectoryOpen, beforeRename]) {
        if (callback !== undefined && typeof callback !== 'function') {
            throw new TypeError('retained filesystem hooks must be functions');
        }
    }

    const withDirectory = (directory, {
        create,
        errorCode,
        purpose,
    }, operation) => {
        const relative = assertBeneath(fixedHomeRoot, directory, 'continuation_store');
        let directoryFd = -1;
        try {
            if (process.platform !== 'linux') {
                throw stateError('PLOINKY_RETAINED_FD_UNAVAILABLE');
            }
            directoryFd = fs.openSync(fixedHomeRoot, DIRECTORY_OPEN_FLAGS);
            const rootStat = fs.fstatSync(directoryFd);
            if (!rootStat.isDirectory()) throw stateError(errorCode);

            for (const segment of relative.split(path.sep)) {
                let childFd = -1;
                const childPath = retainedPath(directoryFd, segment);
                try {
                    childFd = fs.openSync(childPath, DIRECTORY_OPEN_FLAGS);
                } catch (error) {
                    if (!create || error?.code !== 'ENOENT') throw error;
                    fs.mkdirSync(childPath, { mode: 0o700 });
                    childFd = fs.openSync(childPath, DIRECTORY_OPEN_FLAGS);
                }
                fs.closeSync(directoryFd);
                directoryFd = childFd;
            }

            if (afterDirectoryOpen) afterDirectoryOpen(Object.freeze({ directory, purpose }));
            return operation(directoryFd);
        } catch (error) {
            if (error?.code === 'PLOINKY_RETAINED_FD_UNAVAILABLE' || error?.code === errorCode) {
                throw error;
            }
            throw stateError(errorCode, error);
        } finally {
            if (directoryFd >= 0) {
                try { fs.closeSync(directoryFd); } catch (_) { }
            }
        }
    };

    const ensureDirectory = (directory, options) => withDirectory(
        directory,
        options,
        () => directory,
    );

    const atomicWrite = (directory, name, contents, options) => withDirectory(
        directory,
        options,
        (directoryFd) => {
            const finalName = assertLeafName(name);
            const temporaryName = `${finalName}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
            const temporaryPath = retainedPath(directoryFd, temporaryName);
            const finalPath = retainedPath(directoryFd, finalName);
            let temporaryFd = -1;
            let installedFd = -1;
            let renameCompleted = false;
            let installedVerified = false;
            try {
                temporaryFd = fs.openSync(temporaryPath, FILE_WRITE_FLAGS, 0o600);
                fs.writeFileSync(temporaryFd, contents);
                fs.fsyncSync(temporaryFd);
                if (beforeRename) {
                    beforeRename(Object.freeze({
                        directory,
                        purpose: options.purpose,
                        temporaryPath,
                        finalPath,
                    }));
                }
                fs.renameSync(temporaryPath, finalPath);
                renameCompleted = true;
                installedFd = fs.openSync(finalPath, FILE_READ_FLAGS);
                const written = fs.fstatSync(temporaryFd);
                const installed = fs.fstatSync(installedFd);
                if (written.dev !== installed.dev || written.ino !== installed.ino) {
                    throw stateError(options.errorCode);
                }
                fs.fsyncSync(installedFd);
                fs.fsyncSync(directoryFd);
                installedVerified = true;
            } finally {
                if (installedFd >= 0) {
                    try { fs.closeSync(installedFd); } catch (_) { }
                }
                if (temporaryFd >= 0) {
                    try { fs.closeSync(temporaryFd); } catch (_) { }
                }
                if (renameCompleted && !installedVerified) {
                    try { fs.unlinkSync(finalPath); } catch (_) { }
                    try { fs.fsyncSync(directoryFd); } catch (_) { }
                }
                try { fs.unlinkSync(temporaryPath); } catch (_) { }
            }
        },
    );

    const readFile = (directory, name, options) => withDirectory(
        directory,
        options,
        (directoryFd) => {
            let fileFd = -1;
            try {
                fileFd = fs.openSync(retainedPath(directoryFd, name), FILE_READ_FLAGS);
                const stat = fs.fstatSync(fileFd);
                if (!stat.isFile()) throw stateError(options.errorCode);
                return fs.readFileSync(fileFd, 'utf8');
            } finally {
                if (fileFd >= 0) {
                    try { fs.closeSync(fileFd); } catch (_) { }
                }
            }
        },
    );

    return Object.freeze({ atomicWrite, ensureDirectory, readFile });
}

function projectIdentity(value) {
    const projectDir = String(value || '');
    if (!projectDir.startsWith('/workspace/') || projectDir.includes('\0')
        || path.posix.normalize(projectDir) !== projectDir) {
        throw new Error('invalid_continuation_record');
    }
    return projectDir;
}

function createContinuationStore({ homeRoot, storeRoot, sessionRoot }, filesystem) {
    const fixedHomeRoot = assertRoot(homeRoot, 'provider_home');
    const fixedStoreRoot = assertRoot(storeRoot, 'continuation_store');
    const fixedSessionRoot = assertRoot(sessionRoot, 'pi_session_store');
    assertBeneath(fixedHomeRoot, fixedStoreRoot, 'continuation_store');
    assertBeneath(fixedHomeRoot, fixedSessionRoot, 'pi_session_store');
    const stateFilesystem = filesystem ?? createRetainedFilesystem(fixedHomeRoot);
    if (!stateFilesystem || typeof stateFilesystem !== 'object'
        || typeof stateFilesystem.atomicWrite !== 'function'
        || typeof stateFilesystem.ensureDirectory !== 'function'
        || typeof stateFilesystem.readFile !== 'function') {
        throw new TypeError('continuation filesystem must provide retained directory operations');
    }

    const sessionDirectory = (handle) => {
        stateFilesystem.ensureDirectory(fixedSessionRoot, {
            create: true,
            errorCode: 'unsafe_pi_session_directory',
            purpose: 'pi-session-root-create',
        });
        const directory = path.join(fixedSessionRoot, assertHandle(handle));
        stateFilesystem.ensureDirectory(directory, {
            create: true,
            errorCode: 'unsafe_pi_session_directory',
            purpose: 'pi-session-create',
        });
        return directory;
    };

    const existingSessionDirectory = (handle) => {
        const directory = path.join(fixedSessionRoot, assertHandle(handle));
        stateFilesystem.ensureDirectory(directory, {
            create: false,
            errorCode: 'unsafe_pi_session_directory',
            purpose: 'pi-session-read',
        });
        return directory;
    };

    const writeContinuationRecord = (handle, record) => {
        const normalized = assertHandle(handle);
        const selectedProject = projectIdentity(record?.projectDir);
        const value = {
            version: 1,
            provider: 'pi',
            sessionId: normalized,
            sessionDir: sessionDirectory(normalized),
            projectDir: selectedProject,
            createdAt: String(record?.createdAt || new Date().toISOString()),
            updatedAt: new Date().toISOString(),
        };
        stateFilesystem.atomicWrite(
            fixedStoreRoot,
            `${normalized}.json`,
            `${JSON.stringify(value)}\n`,
            {
                create: true,
                errorCode: 'unsafe_continuation_store',
                purpose: 'continuation-record-write',
            },
        );
        return value;
    };

    const readContinuationRecord = (handle) => {
        const normalized = assertHandle(handle);
        const parsed = JSON.parse(stateFilesystem.readFile(
            fixedStoreRoot,
            `${normalized}.json`,
            {
                create: false,
                errorCode: 'unsafe_continuation_record',
                purpose: 'continuation-record-read',
            },
        ));
        if (parsed?.version !== 1 || parsed?.provider !== 'pi' || parsed?.sessionId !== normalized) {
            throw new Error('invalid_continuation_record');
        }
        return {
            ...parsed,
            projectDir: projectIdentity(parsed.projectDir),
            sessionDir: existingSessionDirectory(normalized),
        };
    };

    return Object.freeze({
        readContinuationRecord,
        sessionDirectory,
        writeContinuationRecord,
    });
}

const continuationStore = createContinuationStore({
    homeRoot: '/home/agent',
    storeRoot: STORE_DIRECTORY,
    sessionRoot: SESSION_DIRECTORY,
});

export function createContinuationHandle() {
    return crypto.randomUUID();
}

export function sessionDirectory(handle) {
    return continuationStore.sessionDirectory(handle);
}

export function writeContinuationRecord(handle, record) {
    return continuationStore.writeContinuationRecord(handle, record);
}

export function readContinuationRecord(handle) {
    return continuationStore.readContinuationRecord(handle);
}

export function continuationDescriptor(handle) {
    return {
        version: 1,
        handle: assertHandle(handle),
        toolName: 'continue-task',
    };
}

export const __testables = Object.freeze({
    HANDLE_RE,
    SESSION_DIRECTORY,
    STORE_DIRECTORY,
    assertHandle,
    createContinuationStore,
    createRetainedFilesystem,
});
