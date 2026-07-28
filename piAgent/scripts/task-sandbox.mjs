import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_BWRAP_PATH = '/usr/bin/bwrap';
const probeCache = new Map();
const BLOCKED_ENV_NAMES = new Set([
    'BASH_ENV',
    'ENV',
    'LD_PRELOAD',
    'LD_LIBRARY_PATH',
    'NODE_OPTIONS',
    'PLOINKY_AGENT_SECRET',
    'PLOINKY_MASTER_KEY',
    'PLOINKY_TASK_BWRAP_BIN',
]);

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
    if (procMode === 'private') {
        args.push('--proc', '/proc');
    } else {
        args.push('--dir', '/proc');
    }
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

export function resolveBubblewrap(env = process.env) {
    const override = String(env.PLOINKY_TASK_BWRAP_BIN || '').trim();
    const candidate = override || DEFAULT_BWRAP_PATH;
    if (!path.isAbsolute(candidate)) {
        throw new Error(`bubblewrap path must be absolute: ${candidate}`);
    }
    const resolved = resolveExisting(candidate, 'bubblewrap');
    try {
        fs.accessSync(resolved, fs.constants.X_OK);
    } catch {
        throw new Error(`bubblewrap is not executable: ${resolved}`);
    }
    return resolved;
}

export function probeNestedBubblewrap(env = process.env) {
    const bwrap = resolveBubblewrap(env);
    if (probeCache.has(bwrap)) return probeCache.get(bwrap);

    const attempts = [];
    for (const procMode of ['private', 'empty']) {
        const result = spawnSync(bwrap, minimalProbeArgs(procMode), {
            encoding: 'utf8',
            env: {
                PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
            },
            timeout: 5000,
        });
        const explicitTestBinary = Boolean(String(env.PLOINKY_TASK_BWRAP_BIN || '').trim());
        if (result.status === 0 && (!result.error || explicitTestBinary)) {
            const value = { bwrap, procMode };
            probeCache.set(bwrap, value);
            return value;
        }
        attempts.push(
            result.error?.message
            || String(result.stderr || '').trim()
            || `exit ${result.status ?? 'unknown'} using ${procMode} /proc`,
        );
    }
    throw new Error(`nested bubblewrap is unavailable: ${attempts.join('; ')}`);
}

export function resolveSandboxProject(projectDir, env = process.env) {
    const configuredWorkspace = String(env.PLOINKY_WORKSPACE_ROOT || '').trim();
    if (!configuredWorkspace) {
        throw new Error('PLOINKY_WORKSPACE_ROOT is required');
    }
    const workspaceRoot = resolveExisting(
        configuredWorkspace,
        'PLOINKY_WORKSPACE_ROOT',
    );
    const resolvedProject = resolveExisting(projectDir, 'projectDir');
    if (!fs.statSync(resolvedProject).isDirectory()) {
        throw new Error(`projectDir is not a directory: ${resolvedProject}`);
    }
    if (!isInside(resolvedProject, workspaceRoot)) {
        throw new Error(`projectDir must stay inside PLOINKY_WORKSPACE_ROOT: ${resolvedProject}`);
    }
    return resolvedProject;
}

function sandboxEnvironment(env) {
    const values = {
        ...env,
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
        XDG_CONFIG_HOME: '/root/.config',
        XDG_DATA_HOME: '/root/.local/share',
        XDG_CACHE_HOME: '/tmp/cache',
        XDG_STATE_HOME: '/root/.local/state',
    };
    return Object.entries(values)
        .filter(([name, value]) => (
            !BLOCKED_ENV_NAMES.has(name)
            && value !== undefined
            && value !== null
            && !name.startsWith('DYLD_')
        ))
        .sort(([left], [right]) => left.localeCompare(right));
}

export function buildTaskSandboxLaunch({
    projectDir,
    command,
    args = [],
    env = process.env,
    readOnlyPaths = [],
    writablePaths = [],
} = {}) {
    const resolvedProject = resolveSandboxProject(projectDir, env);
    const workspaceRoot = resolveExisting(
        String(env.PLOINKY_WORKSPACE_ROOT).trim(),
        'PLOINKY_WORKSPACE_ROOT',
    );
    const resolvedCommand = resolveExisting(command, 'sandbox command');
    const { bwrap, procMode } = probeNestedBubblewrap(env);
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
    if (procMode === 'private') {
        sandboxArgs.push('--proc', '/proc');
    } else {
        sandboxArgs.push('--dir', '/proc');
    }
    sandboxArgs.push('--dev', '/dev', '--tmpfs', '/tmp');

    for (const candidate of [resolvedCommand, ...readOnlyPaths]) {
        if (!candidate || !fs.existsSync(candidate)) continue;
        const resolved = fs.realpathSync(candidate);
        if (isInside(resolved, workspaceRoot) && !isInside(resolved, resolvedProject)) {
            throw new Error(`task mount must not expose another workspace path: ${resolved}`);
        }
        addOptionalReadOnlyBind(sandboxArgs, candidate);
    }
    for (const candidate of [...writablePaths, resolvedProject]) {
        if (!candidate || !fs.existsSync(candidate)) continue;
        const resolved = fs.realpathSync(candidate);
        if (isInside(resolved, workspaceRoot) && !isInside(resolved, resolvedProject)) {
            throw new Error(`task mount must not expose another workspace path: ${resolved}`);
        }
        addParentDirectories(sandboxArgs, resolved);
        sandboxArgs.push('--bind', resolved, resolved);
    }
    sandboxArgs.push('--remount-ro', '/');
    for (const [name, value] of sandboxEnvironment(env)) {
        sandboxArgs.push('--setenv', name, String(value));
    }
    sandboxArgs.push(
        '--chdir',
        resolvedProject,
        '--',
        resolvedCommand,
        ...args.map(String),
    );
    return {
        command: bwrap,
        args: sandboxArgs,
        cwd: resolvedProject,
        projectDir: resolvedProject,
    };
}

export const __testables = {
    BLOCKED_ENV_NAMES,
    isInside,
    minimalProbeArgs,
    sandboxEnvironment,
};
