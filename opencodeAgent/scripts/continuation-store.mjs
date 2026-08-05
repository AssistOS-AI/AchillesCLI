import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const HANDLE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stateError(code, cause) {
    const error = new Error(code, cause ? { cause } : undefined);
    error.code = code;
    return error;
}

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

function runtimeHome(env = process.env) {
    const value = env?.HOME;
    if (typeof value !== 'string' || value.includes('\0')) {
        throw new Error('invalid_provider_home');
    }
    return assertRoot(value, 'provider_home');
}

export function continuationStoreForHome(homeRoot, filesystem) {
    const fixedHomeRoot = assertRoot(homeRoot, 'provider_home');
    return createContinuationStore({
        homeRoot: fixedHomeRoot,
        storeRoot: path.join(fixedHomeRoot, '.ploinky', 'task-sessions'),
    }, filesystem);
}

export function continuationStoreForEnvironment(env = process.env, filesystem) {
    return continuationStoreForHome(runtimeHome(env), filesystem);
}

function assertBeneath(homeRoot, directory) {
    const relative = path.relative(homeRoot, directory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('invalid_continuation_store');
    }
    return relative;
}

function assertLeafName(name) {
    if (typeof name !== 'string' || !name || name === '.' || name === '..'
        || name.includes('/') || name.includes('\0')) {
        throw stateError('invalid_continuation_record');
    }
    return name;
}

function assertProjectDir(value) {
    const projectDir = String(value || '').trim();
    if (!projectDir
        || !path.posix.isAbsolute(projectDir)
        || projectDir === '/workspace'
        || !projectDir.startsWith('/workspace/')
        || path.posix.normalize(projectDir) !== projectDir) {
        throw new Error('invalid_continuation_record');
    }
    return projectDir;
}

function assertRetainedFdSupport() {
    if (process.platform !== 'linux'
        || !Number.isInteger(fs.constants.O_DIRECTORY)
        || !Number.isInteger(fs.constants.O_NOFOLLOW)
        || fs.constants.O_NOFOLLOW === 0) {
        throw stateError('PLOINKY_RETAINED_FD_UNAVAILABLE');
    }
}

function retainedPath(directoryFd, leaf = '') {
    assertRetainedFdSupport();
    const root = `/proc/self/fd/${directoryFd}`;
    return leaf ? `${root}/${assertLeafName(leaf)}` : root;
}

function sameInode(left, right) {
    return left.dev === right.dev && left.ino === right.ino;
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

    const directoryFlags = () => {
        assertRetainedFdSupport();
        return fs.constants.O_RDONLY
            | fs.constants.O_DIRECTORY
            | fs.constants.O_NOFOLLOW
            | (fs.constants.O_CLOEXEC || 0);
    };
    const fileReadFlags = () => {
        assertRetainedFdSupport();
        return fs.constants.O_RDONLY
            | fs.constants.O_NOFOLLOW
            | (fs.constants.O_CLOEXEC || 0);
    };
    const fileWriteFlags = () => {
        assertRetainedFdSupport();
        return fs.constants.O_WRONLY
            | fs.constants.O_CREAT
            | fs.constants.O_EXCL
            | fs.constants.O_NOFOLLOW
            | (fs.constants.O_CLOEXEC || 0);
    };
    const fileVerifyFlags = () => {
        assertRetainedFdSupport();
        return fs.constants.O_RDONLY
            | fs.constants.O_NOFOLLOW
            | (fs.constants.O_CLOEXEC || 0);
    };

    const withDirectory = (directory, { create, errorCode, purpose }, operation) => {
        const relative = assertBeneath(fixedHomeRoot, directory);
        let directoryFd = -1;
        try {
            directoryFd = fs.openSync(fixedHomeRoot, directoryFlags());
            if (!fs.fstatSync(directoryFd).isDirectory()) throw stateError(errorCode);
            for (const segment of relative.split(path.sep)) {
                let childFd = -1;
                const childPath = retainedPath(directoryFd, segment);
                try {
                    childFd = fs.openSync(childPath, directoryFlags());
                } catch (error) {
                    if (!create || error?.code !== 'ENOENT') throw error;
                    try {
                        fs.mkdirSync(childPath, { mode: 0o700 });
                    } catch (mkdirError) {
                        if (mkdirError?.code !== 'EEXIST') throw mkdirError;
                    }
                    childFd = fs.openSync(childPath, directoryFlags());
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

    const atomicWrite = (directory, name, contents, options) => withDirectory(
        directory,
        options,
        (directoryFd) => {
            const finalName = assertLeafName(name);
            const temporaryName = `.${finalName}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
            const temporaryPath = retainedPath(directoryFd, temporaryName);
            const finalPath = retainedPath(directoryFd, finalName);
            let temporaryFd = -1;
            let installedFd = -1;
            let renameCompleted = false;
            let installedVerified = false;
            try {
                temporaryFd = fs.openSync(temporaryPath, fileWriteFlags(), 0o600);
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
                installedFd = fs.openSync(finalPath, fileVerifyFlags());
                if (!sameInode(fs.fstatSync(temporaryFd), fs.fstatSync(installedFd))) {
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
                fileFd = fs.openSync(retainedPath(directoryFd, name), fileReadFlags());
                if (!fs.fstatSync(fileFd).isFile()) throw stateError(options.errorCode);
                return fs.readFileSync(fileFd, 'utf8');
            } finally {
                if (fileFd >= 0) {
                    try { fs.closeSync(fileFd); } catch (_) { }
                }
            }
        },
    );

    return Object.freeze({ atomicWrite, readFile });
}

function createContinuationStore({ homeRoot, storeRoot }, filesystem) {
    const fixedHomeRoot = assertRoot(homeRoot, 'provider_home');
    const fixedStoreRoot = assertRoot(storeRoot, 'continuation_store');
    assertBeneath(fixedHomeRoot, fixedStoreRoot);
    const stateFilesystem = filesystem ?? createRetainedFilesystem(fixedHomeRoot);
    if (!stateFilesystem || typeof stateFilesystem !== 'object'
        || typeof stateFilesystem.atomicWrite !== 'function'
        || typeof stateFilesystem.readFile !== 'function') {
        throw new TypeError('continuation filesystem must provide retained directory operations');
    }

    const writeContinuationRecord = (handle, record) => {
        const normalized = assertHandle(handle);
        const value = {
            version: 1,
            provider: 'opencode',
            sessionId: String(record?.sessionId || '').trim(),
            projectDir: assertProjectDir(record?.projectDir),
            createdAt: String(record?.createdAt || new Date().toISOString()),
            updatedAt: new Date().toISOString(),
        };
        if (!value.sessionId) throw new Error('invalid_continuation_record');
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
        if (parsed?.version !== 1 || parsed?.provider !== 'opencode') {
            throw new Error('invalid_continuation_record');
        }
        const sessionId = String(parsed.sessionId || '').trim();
        if (!sessionId) throw new Error('invalid_continuation_record');
        return { ...parsed, sessionId, projectDir: assertProjectDir(parsed.projectDir) };
    };

    return Object.freeze({ readContinuationRecord, writeContinuationRecord });
}

export function createContinuationHandle() {
    return crypto.randomUUID();
}

export function writeContinuationRecord(handle, record) {
    return continuationStoreForEnvironment().writeContinuationRecord(handle, record);
}

export function readContinuationRecord(handle) {
    return continuationStoreForEnvironment().readContinuationRecord(handle);
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
    assertHandle,
    assertProjectDir,
    runtimeHome,
    continuationStoreForEnvironment,
    createContinuationStore,
    createRetainedFilesystem,
});
