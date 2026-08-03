import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const BWRAP_CAPABILITY_ERROR_CODE = 'PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE';

const DEFAULT_BWRAP_PATH = '/usr/bin/bwrap';
const PROBE_CACHE_TTL_MS = 30_000;
const MAX_PROBE_DIAGNOSTIC_BYTES = 512;
const probeCache = new Map();
const TASK_ENV_ALLOWLIST = new Set([
    'COLORTERM',
    'FORCE_COLOR',
    'LANG',
    'LC_ALL',
    'NO_COLOR',
    'PI_OFFLINE',
    'PI_SKIP_VERSION_CHECK',
    'PLOINKY_ROUTER_URL',
    'TERM',
    'TZ',
]);
const FIXED_TASK_ENV = Object.freeze({
    HOME: '/root',
    PATH: [
        '/root/.local/bin',
        '/root/.opencode/bin',
        '/opt/ploinky-node/bin',
        '/usr/local/sbin',
        '/usr/local/bin',
        '/usr/sbin',
        '/usr/bin',
        '/sbin',
        '/bin',
    ].join(':'),
    TMPDIR: '/tmp',
    XDG_CACHE_HOME: '/tmp/cache',
    XDG_CONFIG_HOME: '/root/.config',
    XDG_DATA_HOME: '/root/.local/share',
    XDG_STATE_HOME: '/root/.local/state',
});

export class BubblewrapCapabilityError extends Error {
    constructor(message, options = {}) {
        super(message, options);
        this.name = 'BubblewrapCapabilityError';
        this.code = BWRAP_CAPABILITY_ERROR_CODE;
        this.status = 422;
    }
}

function capabilityError(message, cause) {
    return new BubblewrapCapabilityError(message, cause ? { cause } : undefined);
}

function isInside(candidate, root) {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveExisting(candidate, label) {
    try {
        return fs.realpathSync(path.resolve(candidate));
    } catch {
        throw new Error(`${label} does not exist: ${candidate}`);
    }
}

function addParentDirectories(args, targetPath) {
    const parts = path.resolve(targetPath).split(path.sep).filter(Boolean);
    let current = '';
    for (const part of parts.slice(0, -1)) {
        current += `${path.sep}${part}`;
        args.push('--dir', current);
    }
}

function addOptionalReadOnlyBind(args, candidate) {
    if (!candidate || !fs.existsSync(candidate)) return;
    const resolved = fs.realpathSync(candidate);
    addParentDirectories(args, resolved);
    args.push('--ro-bind', resolved, resolved);
}

function systemMountArgs() {
    const args = ['--ro-bind', '/usr', '/usr'];
    for (const candidate of ['/bin', '/sbin', '/lib', '/lib64']) {
        if (!fs.existsSync(candidate)) continue;
        const stat = fs.lstatSync(candidate);
        if (stat.isSymbolicLink()) {
            args.push('--symlink', fs.readlinkSync(candidate), candidate);
        } else {
            args.push('--ro-bind', candidate, candidate);
        }
    }
    addOptionalReadOnlyBind(args, '/etc');
    addOptionalReadOnlyBind(args, '/opt/ploinky-node');
    return args;
}

function minimalProbeArgs(procMode) {
    const args = [
        '--die-with-parent',
        '--unshare-user',
        '--unshare-pid',
        '--unshare-ipc',
        '--unshare-uts',
        '--share-net',
        ...systemMountArgs(),
    ];
    args.push(procMode === 'private' ? '--proc' : '--dir', '/proc');
    args.push(
        '--dev',
        '/dev',
        '--tmpfs',
        '/tmp',
        '--remount-ro',
        '/',
        '--',
        '/usr/bin/true',
    );
    return args;
}

function normalizeDependencies(dependencies = {}) {
    return {
        bwrapPath: dependencies.bwrapPath || DEFAULT_BWRAP_PATH,
        now: typeof dependencies.now === 'function' ? dependencies.now : Date.now,
        procInspector: typeof dependencies.procInspector === 'function'
            ? dependencies.procInspector
            : null,
        spawnSyncImpl: typeof dependencies.spawnSyncImpl === 'function'
            ? dependencies.spawnSyncImpl
            : spawnSync,
        taskEnvironmentNames: Array.isArray(dependencies.taskEnvironmentNames)
            ? dependencies.taskEnvironmentNames.filter((name) => (
                typeof name === 'string'
                && name
                && !/(?:^|_)(?:API_KEY|CREDENTIAL|PASSWORD|SECRET|TOKEN)$/u.test(name)
            ))
            : [],
    };
}

export function inspectCurrentProcfs({
    fsApi = fs,
    pid = process.pid,
    procRoot = '/proc',
} = {}) {
    const processPid = Number(pid);
    try {
        const procSelfTarget = fsApi.readlinkSync(path.join(procRoot, 'self'));
        const procSelfPid = Number(path.basename(procSelfTarget));
        const namespacePath = path.join(procRoot, String(processPid), 'ns', 'pid');
        const pidNamespaceVisible = fsApi.existsSync(namespacePath);
        const namespaceStat = pidNamespaceVisible
            ? fsApi.statSync(namespacePath, { bigint: true })
            : null;
        return Object.freeze({
            ok: Number.isInteger(processPid)
                && processPid > 0
                && procSelfPid === processPid
                && pidNamespaceVisible,
            processPid,
            procSelfPid,
            pidNamespaceVisible,
            namespaceDevice: namespaceStat ? String(namespaceStat.dev) : '',
            namespaceInode: namespaceStat ? String(namespaceStat.ino) : '',
            error: null,
        });
    } catch (error) {
        return Object.freeze({
            ok: false,
            processPid,
            procSelfPid: null,
            pidNamespaceVisible: false,
            namespaceDevice: '',
            namespaceInode: '',
            error: error?.message || String(error),
        });
    }
}

export function assertCurrentProcfs({ dependencies = {} } = {}) {
    const resolved = normalizeDependencies(dependencies);
    const inspected = resolved.procInspector
        ? Object.freeze({ ...resolved.procInspector() })
        : inspectCurrentProcfs();
    const result = Object.freeze({
        ...inspected,
        ok: inspected.ok === true
            && Number.isInteger(inspected.processPid)
            && inspected.processPid > 0
            && inspected.procSelfPid === inspected.processPid
            && inspected.pidNamespaceVisible === true,
    });
    if (result.ok) return result;
    const procSelf = Number.isInteger(result.procSelfPid)
        ? String(result.procSelfPid)
        : 'unavailable';
    const detail = result.error ? ` (${boundedText(result.error)})` : '';
    throw capabilityError(
        `Task sandbox requires /proc to represent its current PID namespace `
        + `(process PID ${result.processPid}, /proc/self ${procSelf})${detail}. `
        + `Do not bind a parent container's /proc into the agent container.`,
    );
}

function binaryIdentity(candidate) {
    let realpath;
    try {
        realpath = fs.realpathSync(path.resolve(candidate));
    } catch (error) {
        throw capabilityError(`bubblewrap does not exist: ${candidate}`, error);
    }
    let stat;
    try {
        fs.accessSync(realpath, fs.constants.X_OK);
        stat = fs.statSync(realpath, { bigint: true });
    } catch (error) {
        throw capabilityError(`bubblewrap is not executable: ${realpath}`, error);
    }
    if (!stat.isFile()) throw capabilityError(`bubblewrap is not a regular file: ${realpath}`);
    return Object.freeze({
        realpath,
        device: String(stat.dev),
        inode: String(stat.ino),
        size: String(stat.size),
        mtimeNs: String(stat.mtimeNs ?? BigInt(Math.trunc(Number(stat.mtimeMs) * 1_000_000))),
    });
}

export function resolveBubblewrap({ dependencies = {} } = {}) {
    const resolved = normalizeDependencies(dependencies);
    const candidate = String(resolved.bwrapPath || '').trim();
    if (!path.isAbsolute(candidate)) {
        throw capabilityError(`bubblewrap path must be absolute: ${candidate}`);
    }
    return binaryIdentity(candidate);
}

function boundedText(value, limit = MAX_PROBE_DIAGNOSTIC_BYTES) {
    const bytes = Buffer.from(String(value || '').replace(/[\r\n\t]+/g, ' ').trim(), 'utf8');
    if (bytes.length <= limit) return bytes.toString('utf8');
    let start = bytes.length - limit;
    while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start += 1;
    return bytes.subarray(start).toString('utf8');
}

function attemptDiagnostic(result, procMode) {
    return boundedText(
        result?.error?.message
        || result?.stderr
        || result?.stdout
        || `exit ${result?.status ?? 'unknown'} using ${procMode} /proc`,
    );
}

function capabilityCacheKey(identity, procfs) {
    return JSON.stringify([
        identity.realpath,
        identity.device,
        identity.inode,
        identity.size,
        identity.mtimeNs,
        procfs.processPid,
        procfs.namespaceDevice,
        procfs.namespaceInode,
    ]);
}

export function probeNestedBubblewrap({ dependencies = {} } = {}) {
    const resolved = normalizeDependencies(dependencies);
    const procfs = assertCurrentProcfs({ dependencies: resolved });
    const identity = resolveBubblewrap({ dependencies: resolved });
    const cacheKey = capabilityCacheKey(identity, procfs);
    const now = Number(resolved.now());
    for (const [key, entry] of probeCache) {
        if (entry.expiresAt <= now) probeCache.delete(key);
    }
    const cached = probeCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.value;

    const attempts = [];
    for (const procMode of ['private', 'empty']) {
        let result;
        try {
            result = resolved.spawnSyncImpl(identity.realpath, minimalProbeArgs(procMode), {
                encoding: 'utf8',
                env: {
                    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
                },
                maxBuffer: 64 * 1024,
                timeout: 5000,
            });
        } catch (error) {
            result = { error, status: null };
        }
        if (result?.status === 0 && !result.error) {
            const value = Object.freeze({
                bwrap: identity.realpath,
                binaryIdentity: identity,
                procMode,
                procfs,
            });
            probeCache.set(cacheKey, {
                expiresAt: now + PROBE_CACHE_TTL_MS,
                value,
            });
            return value;
        }
        attempts.push(`${procMode}: ${attemptDiagnostic(result, procMode)}`);
    }
    throw capabilityError(`nested Bubblewrap capability is unavailable (${attempts.join('; ')})`);
}

function inspectProjectPath(projectDir, env = process.env) {
    const configuredWorkspace = String(env.PLOINKY_WORKSPACE_ROOT || '').trim();
    if (!configuredWorkspace) throw new Error('PLOINKY_WORKSPACE_ROOT is required');
    const workspaceInput = path.resolve(configuredWorkspace);
    const workspaceLstat = fs.lstatSync(workspaceInput);
    if (!workspaceLstat.isDirectory() || workspaceLstat.isSymbolicLink()) {
        throw new Error(`PLOINKY_WORKSPACE_ROOT must be a non-symlink directory: ${workspaceInput}`);
    }
    const workspaceRoot = fs.realpathSync(workspaceInput);
    const rawProject = String(projectDir || '').trim();
    if (!rawProject) throw new Error('projectDir is required');
    if (rawProject.split(/[\\/]+/u).includes('..')) {
        throw new Error(`projectDir must not contain traversal segments: ${rawProject}`);
    }
    const requestedProject = path.resolve(rawProject);
    let relative;
    if (isInside(requestedProject, workspaceInput)) {
        relative = path.relative(workspaceInput, requestedProject);
    } else if (isInside(requestedProject, workspaceRoot)) {
        relative = path.relative(workspaceRoot, requestedProject);
    } else {
        throw new Error(`projectDir must stay inside PLOINKY_WORKSPACE_ROOT: ${requestedProject}`);
    }
    const projectPath = path.join(workspaceRoot, relative);
    let current = workspaceRoot;
    let missing = false;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);
        if (missing) continue;
        try {
            const stat = fs.lstatSync(current);
            if (stat.isSymbolicLink()) throw new Error(`projectDir must not contain symlinks: ${current}`);
            if (!stat.isDirectory()) throw new Error(`projectDir component is not a directory: ${current}`);
        } catch (error) {
            if (error?.code === 'ENOENT') missing = true;
            else throw error;
        }
    }
    return Object.freeze({ projectPath, workspaceRoot, missing });
}

function createProjectPath(inspection) {
    const relative = path.relative(inspection.workspaceRoot, inspection.projectPath);
    let current = inspection.workspaceRoot;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);
        try {
            const existing = fs.lstatSync(current);
            if (!existing.isDirectory() || existing.isSymbolicLink()) {
                throw new Error(`projectDir component is unsafe: ${current}`);
            }
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
            fs.mkdirSync(current, { mode: 0o700 });
            const created = fs.lstatSync(current);
            if (!created.isDirectory() || created.isSymbolicLink()) {
                throw new Error(`projectDir component is unsafe after creation: ${current}`);
            }
        }
    }
}

export function resolveSandboxProject(projectDir, env = process.env) {
    const inspection = inspectProjectPath(projectDir, env);
    if (inspection.missing) throw new Error(`projectDir does not exist: ${inspection.projectPath}`);
    const resolvedProject = fs.realpathSync(inspection.projectPath);
    if (resolvedProject !== inspection.projectPath || !isInside(resolvedProject, inspection.workspaceRoot)) {
        throw new Error(`projectDir changed or escaped PLOINKY_WORKSPACE_ROOT: ${resolvedProject}`);
    }
    return resolvedProject;
}

export function prepareTaskSandbox({
    projectDir,
    env = process.env,
    createProjectDir = false,
    dependencies = {},
} = {}) {
    const inspection = inspectProjectPath(projectDir, env);
    const capability = probeNestedBubblewrap({ dependencies });
    if (inspection.missing) {
        if (!createProjectDir) throw new Error(`projectDir does not exist: ${inspection.projectPath}`);
        createProjectPath(inspection);
    }
    const resolvedProject = resolveSandboxProject(inspection.projectPath, env);
    return Object.freeze({ capability, projectDir: resolvedProject });
}

function sandboxEnvironment(env, dependencies = {}) {
    const resolved = normalizeDependencies(dependencies);
    const allowedNames = new Set([...TASK_ENV_ALLOWLIST, ...resolved.taskEnvironmentNames]);
    const values = { ...FIXED_TASK_ENV };
    for (const name of allowedNames) {
        if (!Object.hasOwn(env, name)) continue;
        const value = env[name];
        if (value === undefined || value === null) continue;
        values[name] = String(value);
    }
    return Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
}

export function buildTaskSandboxLaunch({
    projectDir,
    command,
    args = [],
    env = process.env,
    readOnlyPaths = [],
    writablePaths = [],
    dependencies = {},
} = {}) {
    const resolvedProject = resolveSandboxProject(projectDir, env);
    const workspaceRoot = resolveExisting(
        String(env.PLOINKY_WORKSPACE_ROOT).trim(),
        'PLOINKY_WORKSPACE_ROOT',
    );
    const resolvedCommand = resolveExisting(command, 'sandbox command');
    const { bwrap, procMode } = probeNestedBubblewrap({ dependencies });
    const sandboxArgs = [
        '--die-with-parent',
        '--unshare-user',
        '--unshare-pid',
        '--unshare-ipc',
        '--unshare-uts',
        '--share-net',
        '--clearenv',
        ...systemMountArgs(),
    ];
    sandboxArgs.push(procMode === 'private' ? '--proc' : '--dir', '/proc');
    sandboxArgs.push('--dev', '/dev', '--tmpfs', '/tmp');

    for (const candidate of [resolvedCommand, ...readOnlyPaths]) {
        if (!candidate || !fs.existsSync(candidate)) continue;
        const resolvedPath = fs.realpathSync(candidate);
        if (isInside(resolvedPath, workspaceRoot) && !isInside(resolvedPath, resolvedProject)) {
            throw new Error(`task mount must not expose another workspace path: ${resolvedPath}`);
        }
        addOptionalReadOnlyBind(sandboxArgs, candidate);
    }
    for (const candidate of [...writablePaths, resolvedProject]) {
        if (!candidate || !fs.existsSync(candidate)) continue;
        const resolvedPath = fs.realpathSync(candidate);
        if (isInside(resolvedPath, workspaceRoot) && !isInside(resolvedPath, resolvedProject)) {
            throw new Error(`task mount must not expose another workspace path: ${resolvedPath}`);
        }
        addParentDirectories(sandboxArgs, resolvedPath);
        sandboxArgs.push('--bind', resolvedPath, resolvedPath);
    }
    sandboxArgs.push('--remount-ro', '/');
    for (const [name, value] of sandboxEnvironment(env, dependencies)) {
        sandboxArgs.push('--setenv', name, value);
    }
    sandboxArgs.push(
        '--chdir',
        resolvedProject,
        '--',
        resolvedCommand,
        ...args.map(String),
    );
    return Object.freeze({
        command: bwrap,
        args: Object.freeze(sandboxArgs),
        cwd: resolvedProject,
        projectDir: resolvedProject,
    });
}

export const __testables = {
    FIXED_TASK_ENV,
    TASK_ENV_ALLOWLIST,
    clearProbeCache: () => probeCache.clear(),
    inspectProjectPath,
    isInside,
    minimalProbeArgs,
    sandboxEnvironment,
};
