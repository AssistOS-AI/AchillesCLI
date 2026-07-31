import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX_CAPTURE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_GENERATED_ROUTER_DESCRIPTOR_BYTES = 64 * 1024;
const GENERATED_ROUTER_DESCRIPTOR_PATH = '/run/ploinky/router-descriptor.json';
const GENERATED_ROUTER_DESCRIPTOR_SOURCE = 'PLOINKY_ENV_SOURCE_PLOINKY_ROUTER_DESCRIPTOR_FILE';
const privateProcSupport = new Map();

export function findBubblewrap() {
    const candidates = ['/usr/bin/bwrap', '/bin/bwrap'];
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
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
        const pidNamespaceVisible = fsApi.existsSync(
            path.join(procRoot, String(processPid), 'ns', 'pid'),
        );
        return Object.freeze({
            ok: Number.isInteger(processPid)
                && processPid > 0
                && procSelfPid === processPid
                && pidNamespaceVisible,
            processPid,
            procSelfPid,
            pidNamespaceVisible,
            error: null,
        });
    } catch (error) {
        return Object.freeze({
            ok: false,
            processPid,
            procSelfPid: null,
            pidNamespaceVisible: false,
            error: error?.message || String(error),
        });
    }
}

export function assertCurrentProcfs(options = {}) {
    const result = inspectCurrentProcfs(options);
    if (result.ok) return result;
    const procSelf = Number.isInteger(result.procSelfPid)
        ? String(result.procSelfPid)
        : 'unavailable';
    const detail = result.error ? ` (${result.error})` : '';
    throw new Error(
        `AchillesCLI requires /proc to represent its current PID namespace `
        + `(process PID ${result.processPid}, /proc/self ${procSelf})${detail}. `
        + `Do not bind a parent container's /proc into the agent container.`,
    );
}

export function buildSandboxArgs({
    workspace,
    socketDir = null,
    command,
    args = [],
    extraReadOnlyPaths = [],
    privateProc = canMountPrivateProc(),
} = {}) {
    const resolvedWorkspace = fs.realpathSync(workspace);
    const sandboxArgs = [
        '--die-with-parent',
        '--new-session',
        '--unshare-user',
        '--unshare-pid',
        '--unshare-ipc',
        '--unshare-uts',
        '--share-net',
    ];

    addSystemMounts(sandboxArgs);
    if (privateProc) {
        sandboxArgs.push('--proc', '/proc');
    } else {
        // Rootless Podman/Docker commonly blocks mounting proc from a nested
        // user namespace. An empty /proc preserves filesystem confinement
        // without exposing the outer container's process filesystem.
        sandboxArgs.push('--dir', '/proc');
    }
    sandboxArgs.push('--dev', '/dev', '--tmpfs', '/tmp');

    const writablePaths = [resolvedWorkspace];
    if (socketDir) writablePaths.push(fs.realpathSync(socketDir));
    for (const mountPath of uniqueVisiblePaths([...extraReadOnlyPaths])) {
        addParentDirs(sandboxArgs, mountPath);
        sandboxArgs.push('--ro-bind', mountPath, mountPath);
    }
    for (const mountPath of uniqueVisiblePaths(writablePaths)) {
        addParentDirs(sandboxArgs, mountPath);
        sandboxArgs.push('--bind', mountPath, mountPath);
    }

    sandboxArgs.push(
        '--dir', '/home/achilles',
        '--setenv', 'HOME', '/home/achilles',
        '--setenv', 'TMPDIR', '/tmp',
        '--chdir', resolvedWorkspace,
        '--',
        command,
        ...args,
    );
    return sandboxArgs;
}

export function canMountPrivateProc(bwrap = findBubblewrap()) {
    if (!bwrap) return false;
    if (privateProcSupport.has(bwrap)) return privateProcSupport.get(bwrap);

    const result = spawnSync(bwrap, [
        '--die-with-parent',
        '--unshare-user',
        '--unshare-pid',
        '--ro-bind', '/usr', '/usr',
        '--proc', '/proc',
        '--', '/usr/bin/true',
    ], { stdio: 'ignore' });
    const supported = result.status === 0;
    privateProcSupport.set(bwrap, supported);
    return supported;
}

export function collectMainAgentRuntimeMounts({ entryPath = process.argv[1], extraPaths = [] } = {}) {
    const paths = new Set(extraPaths.map(resolveExistingPath).filter(Boolean));
    const moduleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    paths.add(resolveExistingPath(moduleDir));
    paths.add(resolveExistingPath(path.dirname(entryPath)));
    paths.add(resolveExistingPath(path.resolve(process.execPath, '../..')));

    for (const candidate of ['/code', '/Agent', '/dependencies', '/app/node_modules']) {
        const resolved = resolveExistingPath(candidate);
        if (resolved) paths.add(resolved);
    }

    try {
        const agentLibEntry = fileURLToPath(import.meta.resolve('achillesAgentLib/MainAgent'));
        const marker = `${path.sep}achillesAgentLib${path.sep}`;
        const markerIndex = agentLibEntry.lastIndexOf(marker);
        if (markerIndex >= 0) {
            paths.add(resolveExistingPath(agentLibEntry.slice(0, markerIndex + marker.length - 1)));
            paths.add(resolveExistingPath(agentLibEntry.slice(0, markerIndex)));
        }
    } catch {
        // The normal dependency error remains owned by the child bootstrap.
    }

    return uniqueVisiblePaths([...paths]);
}

export function resolveGeneratedRouterDescriptorMount({
    env = process.env,
    fsApi = fs,
    expectedUid = typeof process.geteuid === 'function' ? process.geteuid() : null,
    expectedGid = typeof process.getegid === 'function' ? process.getegid() : null,
} = {}) {
    const descriptorFile = Object.hasOwn(env, 'PLOINKY_ROUTER_DESCRIPTOR_FILE')
        ? String(env.PLOINKY_ROUTER_DESCRIPTOR_FILE || '')
        : '';
    const source = Object.hasOwn(env, GENERATED_ROUTER_DESCRIPTOR_SOURCE)
        ? String(env[GENERATED_ROUTER_DESCRIPTOR_SOURCE] || '')
        : '';
    if (!descriptorFile && !source) return null;
    if (descriptorFile !== GENERATED_ROUTER_DESCRIPTOR_PATH || source !== 'generated') {
        throw new Error('AchillesCLI refuses an untrusted generated-local Router descriptor mount.');
    }

    let descriptorStat;
    try {
        descriptorStat = fsApi.lstatSync(GENERATED_ROUTER_DESCRIPTOR_PATH);
    } catch (error) {
        throw new Error('AchillesCLI generated-local Router descriptor is unavailable.', { cause: error });
    }
    if (!descriptorStat.isFile()
        || descriptorStat.isSymbolicLink()
        || (descriptorStat.mode & 0o777) !== 0o600
        || descriptorStat.size <= 0
        || descriptorStat.size > MAX_GENERATED_ROUTER_DESCRIPTOR_BYTES
        || (expectedUid !== null && descriptorStat.uid !== expectedUid)
        || (expectedGid !== null && descriptorStat.gid !== expectedGid)) {
        throw new Error('AchillesCLI generated-local Router descriptor has an unsafe filesystem identity.');
    }
    let realDescriptor;
    try {
        realDescriptor = fsApi.realpathSync(GENERATED_ROUTER_DESCRIPTOR_PATH);
    } catch (error) {
        throw new Error('AchillesCLI generated-local Router descriptor cannot be resolved.', { cause: error });
    }
    if (realDescriptor !== GENERATED_ROUTER_DESCRIPTOR_PATH) {
        throw new Error('AchillesCLI generated-local Router descriptor escaped its fixed runtime path.');
    }
    return GENERATED_ROUTER_DESCRIPTOR_PATH;
}

export async function executeProcess({
    command,
    args = [],
    cwd,
    env = process.env,
    timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd,
            env,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let completed = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            setTimeout(() => child.kill('SIGKILL'), 1000).unref();
        }, timeoutMs);

        child.stdout.on('data', (chunk) => {
            stdout = appendBounded(stdout, chunk);
        });
        child.stderr.on('data', (chunk) => {
            stderr = appendBounded(stderr, chunk);
        });
        child.once('error', (error) => {
            if (completed) return;
            completed = true;
            clearTimeout(timer);
            resolve({ success: false, status: null, stdout, stderr, error: error.message, timedOut });
        });
        child.once('close', (status, signal) => {
            if (completed) return;
            completed = true;
            clearTimeout(timer);
            resolve({
                success: status === 0 && !timedOut,
                status,
                signal,
                stdout,
                stderr,
                timedOut,
                error: timedOut
                    ? `Command timed out after ${timeoutMs}ms.`
                    : (status === 0 ? null : stderr.trim() || `Exit code: ${status}`),
            });
        });
    });
}

function addSystemMounts(args) {
    for (const candidate of ['/usr', '/etc']) {
        if (fs.existsSync(candidate)) {
            args.push('--ro-bind', candidate, candidate);
        }
    }
    for (const candidate of ['/bin', '/sbin', '/lib', '/lib64']) {
        if (!fs.existsSync(candidate)) continue;
        const stat = fs.lstatSync(candidate);
        if (stat.isSymbolicLink()) {
            args.push('--symlink', fs.readlinkSync(candidate), candidate);
        } else {
            args.push('--ro-bind', candidate, candidate);
        }
    }
}

function addParentDirs(args, targetPath) {
    const parts = path.resolve(targetPath).split(path.sep).filter(Boolean);
    let current = '';
    for (const part of parts.slice(0, -1)) {
        current += `${path.sep}${part}`;
        args.push('--dir', current);
    }
}

function uniqueVisiblePaths(values) {
    const resolved = [...new Set(values.map(resolveExistingPath).filter(Boolean))]
        .sort((a, b) => a.length - b.length);
    return resolved.filter((candidate, index) => !resolved.some((parent, parentIndex) => (
        parentIndex < index && isInside(candidate, parent)
    )));
}

function isInside(candidate, root) {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveExistingPath(value) {
    if (!value) return null;
    try {
        return fs.realpathSync(path.resolve(value));
    } catch {
        return null;
    }
}

function appendBounded(current, chunk) {
    const next = current + chunk.toString('utf8');
    if (Buffer.byteLength(next, 'utf8') <= MAX_CAPTURE_BYTES) return next;
    return Buffer.from(next, 'utf8').subarray(-MAX_CAPTURE_BYTES).toString('utf8');
}
