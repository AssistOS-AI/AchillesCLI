import fs from 'node:fs';
import path from 'node:path';

const TASK_ID_RE = /^task_[0-9a-f]{24}$/;
const TERMINAL_STATUSES = new Set(['finished', 'stopped', 'error']);
const DEFAULT_TASK_LIMIT = 10;
const MAX_TASK_LIMIT = 100;
const LOG_TAIL_LINES = 5;
const LOG_TAIL_BYTES = 2 * 1024;

function isInside(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function lstatOptional(candidate) {
    try {
        return fs.lstatSync(candidate);
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
}

function assertSafeDirectory(candidate, root) {
    const stat = lstatOptional(candidate);
    if (!stat) return null;
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error('Task history storage is unsafe.');
    }
    const real = fs.realpathSync(candidate);
    if (!isInside(root, real)) {
        throw new Error('Task history storage is unsafe.');
    }
    return real;
}

function assertSafeFile(candidate, root) {
    const stat = lstatOptional(candidate);
    if (!stat) return null;
    if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error('Task history storage is unsafe.');
    }
    const real = fs.realpathSync(candidate);
    if (!isInside(root, real)) {
        throw new Error('Task history storage is unsafe.');
    }
    return { path: real, stat };
}

function resolveTaskStorage(workingDir, { includeLogs = false } = {}) {
    const workspace = fs.realpathSync(workingDir);
    const history = assertSafeDirectory(path.join(workspace, '.copilot_history'), workspace);
    if (!history) return null;
    const journal = assertSafeFile(path.join(history, 'agent_tasks'), history);
    const logDirectory = includeLogs
        ? assertSafeDirectory(path.join(history, 'task_logs'), history)
        : null;
    return {
        history,
        journalPath: journal?.path || '',
        logDirectory,
    };
}

function validTimestamp(value) {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : '';
}

function normalizeTask(raw) {
    if (!raw || typeof raw !== 'object' || !TASK_ID_RE.test(String(raw.id || ''))) {
        return null;
    }
    const status = ['ongoing', 'finished', 'stopped', 'error'].includes(raw.status)
        ? raw.status
        : 'ongoing';
    const createdAt = validTimestamp(raw.createdAt);
    return {
        id: String(raw.id),
        targetAgent: String(raw.targetAgent || '').slice(0, 160),
        remoteTaskId: String(raw.remoteTaskId || '').slice(0, 200),
        toolName: String(raw.toolName || '').slice(0, 160),
        description: String(raw.description || '').replace(/\s+/g, ' ').trim().slice(0, 240),
        status,
        remoteStatus: String(raw.remoteStatus || '').slice(0, 80),
        createdAt,
        updatedAt: validTimestamp(raw.updatedAt) || createdAt,
        error: String(raw.error || '').trim().slice(0, 1000),
        ...(raw.logRetention === 'full' ? { logRetention: 'full' } : {}),
        ...(raw.continuation && typeof raw.continuation === 'object' ? {
            continuation: {
                version: 1,
                targetAgent: String(raw.continuation.targetAgent || raw.targetAgent || '').slice(0, 160),
                toolName: String(raw.continuation.toolName || '').slice(0, 160),
                ...(String(raw.continuation.handle || '').trim()
                    ? { handle: String(raw.continuation.handle).trim().slice(0, 200) }
                    : {}),
            },
        } : {}),
    };
}

export function readWorkspaceTasks(workingDir) {
    const storage = resolveTaskStorage(workingDir);
    if (!storage?.journalPath) return [];
    const tasks = new Map();
    const raw = fs.readFileSync(storage.journalPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
            const task = normalizeTask(JSON.parse(line));
            if (!task) continue;
            const existing = tasks.get(task.id);
            if (existing && TERMINAL_STATUSES.has(existing.status) && task.status === 'ongoing') {
                continue;
            }
            tasks.set(task.id, { ...existing, ...task });
        } catch (_) {
            // Ignore malformed or incomplete append-only journal entries.
        }
    }
    return [...tasks.values()].sort((left, right) => {
        return (Date.parse(right.updatedAt) || 0) - (Date.parse(left.updatedAt) || 0);
    });
}

export function readOngoingTasks(workingDir) {
    return readWorkspaceTasks(workingDir).filter((task) => {
        return task.status === 'ongoing' && task.targetAgent && task.remoteTaskId;
    });
}

function stripTerminalControls(value) {
    return String(value || '')
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

function readTaskLogTail(workingDir, taskId) {
    if (!TASK_ID_RE.test(taskId)) return { text: '', truncated: false };
    const storage = resolveTaskStorage(workingDir, { includeLogs: true });
    if (!storage?.logDirectory) return { text: '', truncated: false };
    const log = assertSafeFile(path.join(storage.logDirectory, `${taskId}.log`), storage.logDirectory);
    if (!log) return { text: '', truncated: false };

    const bytesToRead = Math.min(log.stat.size, LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    const descriptor = fs.openSync(log.path, 'r');
    try {
        fs.readSync(descriptor, buffer, 0, bytesToRead, log.stat.size - bytesToRead);
    } finally {
        fs.closeSync(descriptor);
    }
    const normalized = stripTerminalControls(buffer.toString('utf8')).replace(/\s+$/, '');
    if (!normalized) return { text: '', truncated: log.stat.size > bytesToRead };
    const lines = normalized.split(/\r?\n/);
    const selected = lines.slice(-LOG_TAIL_LINES);
    return {
        text: selected.join('\n'),
        truncated: log.stat.size > bytesToRead || lines.length > selected.length,
    };
}

function parseTaskLimit(rawArgs) {
    const value = String(rawArgs || '').trim().toLowerCase();
    if (!value) return DEFAULT_TASK_LIMIT;
    if (value === 'all') return Infinity;
    if (!/^\d+$/.test(value)) {
        throw new Error('Usage: /tasks [count|all]\n  count must be between 1 and 100.');
    }
    const count = Number.parseInt(value, 10);
    if (count < 1 || count > MAX_TASK_LIMIT) {
        throw new Error('Usage: /tasks [count|all]\n  count must be between 1 and 100.');
    }
    return count;
}

function escapeMarkdownInline(value) {
    return stripTerminalControls(value)
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/([\\`*_[\]{}()#+.!|>\-])/g, '\\$1');
}

function formatTimestamp(value) {
    const timestamp = Date.parse(value || '');
    if (!Number.isFinite(timestamp)) return 'unknown';
    return new Date(timestamp).toISOString().replace('T', ' ').replace('.000Z', 'Z');
}

function safeLogFence(value) {
    return stripTerminalControls(value).replace(/```/g, '`\u200b``');
}

function capUtf8Tail(value, maximumBytes) {
    const buffer = Buffer.from(value, 'utf8');
    if (buffer.length <= maximumBytes) return value;
    return buffer.subarray(buffer.length - maximumBytes)
        .toString('utf8')
        .replace(/^\uFFFD+/, '');
}

function userSafeTaskRead(operation) {
    try {
        return operation();
    } catch (error) {
        if (error?.message === 'Task history storage is unsafe.') throw error;
        const code = typeof error?.code === 'string' ? error.code : 'read_failed';
        throw new Error(`Unable to read task history (${code}).`);
    }
}

export function formatWorkspaceTaskSummary(workingDir, rawArgs = '') {
    const limit = parseTaskLimit(rawArgs);
    const tasks = userSafeTaskRead(() => readWorkspaceTasks(workingDir));
    if (tasks.length === 0) {
        return 'No background tasks found for this workspace.';
    }

    const selected = Number.isFinite(limit) ? tasks.slice(0, limit) : tasks;
    const scope = selected.length === tasks.length
        ? `Showing all ${tasks.length} task${tasks.length === 1 ? '' : 's'}.`
        : `Showing ${selected.length} of ${tasks.length} tasks.`;
    const output = ['## Background tasks', '', scope];

    selected.forEach((task, index) => {
        const name = task.description || task.toolName || task.id;
        const agent = task.targetAgent || 'unknown';
        output.push('', `${index + 1}. **${task.status}** — ${escapeMarkdownInline(name)}`);
        output.push(`   Agent: ${escapeMarkdownInline(agent)} · Updated: ${formatTimestamp(task.updatedAt)}`);
        if (task.error) {
            output.push(`   Error: ${escapeMarkdownInline(task.error)}`);
        }
        if (TERMINAL_STATUSES.has(task.status)) {
            const tail = userSafeTaskRead(() => readTaskLogTail(workingDir, task.id));
            if (tail.text) {
                output.push('', '   Final log:', '```text');
                if (tail.truncated) output.push('[earlier log output omitted]');
                output.push(safeLogFence(capUtf8Tail(tail.text, LOG_TAIL_BYTES)), '```');
            }
        }
    });
    return output.join('\n');
}

export const __testables = {
    LOG_TAIL_BYTES,
    LOG_TAIL_LINES,
    MAX_TASK_LIMIT,
    capUtf8Tail,
    normalizeTask,
    parseTaskLimit,
    readTaskLogTail,
    stripTerminalControls,
    userSafeTaskRead,
};
