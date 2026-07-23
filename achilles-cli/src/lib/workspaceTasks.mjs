import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TASK_ID_RE = /^task_[0-9a-f]{24}$/;
const TERMINAL_STATUSES = new Set(['finished', 'stopped', 'error']);
const DEFAULT_TASK_LIMIT = 10;
const MAX_TASK_LIMIT = 100;
const LOG_TAIL_LINES = 5;
const LOG_TAIL_BYTES = 2 * 1024;
const MAX_LOG_BYTES = 1024 * 1024;
const JOURNAL_NAME = 'agent_tasks';
const LOG_DIRECTORY_NAME = 'task_logs';
const CONTINUATION_HANDLE_RE = /^[A-Za-z0-9_-]{16,200}$/;
const TOOL_NAME_RE = /^[A-Za-z0-9._-]{1,160}$/;

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
    const achillesDirectory = assertSafeDirectory(path.join(workspace, '.achilles-cli'), workspace);
    if (!achillesDirectory) return null;
    const history = assertSafeDirectory(path.join(achillesDirectory, 'tasks'), achillesDirectory);
    if (!history) return null;
    const journal = assertSafeFile(path.join(history, JOURNAL_NAME), history);
    const logDirectory = includeLogs
        ? assertSafeDirectory(path.join(history, LOG_DIRECTORY_NAME), history)
        : null;
    return {
        history,
        journalPath: journal?.path || '',
        logDirectory,
    };
}

function ensureTaskStorage(workingDir) {
    const workspace = fs.realpathSync(workingDir);
    const achillesDirectory = path.join(workspace, '.achilles-cli');
    const history = path.join(achillesDirectory, 'tasks');
    const logDirectory = path.join(history, LOG_DIRECTORY_NAME);
    for (const directory of [achillesDirectory, history, logDirectory]) {
        let stat = lstatOptional(directory);
        if (!stat) {
            try { fs.mkdirSync(directory, { mode: 0o700 }); }
            catch (error) { if (error?.code !== 'EEXIST') throw error; }
            stat = lstatOptional(directory);
        }
        if (!stat?.isDirectory() || stat.isSymbolicLink()) {
            throw new Error('Task history storage is unsafe.');
        }
        if (!isInside(workspace, fs.realpathSync(directory))) {
            throw new Error('Task history storage is unsafe.');
        }
    }
    const journalPath = path.join(history, JOURNAL_NAME);
    assertSafeFile(journalPath, history);
    return { history, journalPath, logDirectory };
}

function validTimestamp(value) {
    return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : '';
}

function normalizeContinuation(raw, fallbackTargetAgent = '') {
    if (!raw || typeof raw !== 'object' || raw.version !== 1) return null;
    const targetAgent = String(raw.targetAgent || fallbackTargetAgent || '').trim().slice(0, 160);
    const toolName = String(raw.toolName || '').trim();
    const handle = String(raw.handle || '').trim();
    if (!targetAgent || !TOOL_NAME_RE.test(toolName)) return null;
    if (handle && !CONTINUATION_HANDLE_RE.test(handle)) return null;
    return {
        version: 1,
        targetAgent,
        toolName,
        ...(handle ? { handle } : {}),
    };
}

function normalizeTask(raw) {
    if (!raw || typeof raw !== 'object' || !TASK_ID_RE.test(String(raw.id || ''))) {
        return null;
    }
    const status = ['ongoing', 'finished', 'stopped', 'error'].includes(raw.status)
        ? raw.status
        : 'ongoing';
    const now = new Date().toISOString();
    const createdAt = validTimestamp(raw.createdAt) || now;
    const continuation = normalizeContinuation(raw.continuation, raw.targetAgent);
    return {
        version: 1,
        id: String(raw.id),
        targetAgent: String(raw.targetAgent || '').slice(0, 160),
        remoteTaskId: String(raw.remoteTaskId || '').slice(0, 200),
        toolName: String(raw.toolName || '').slice(0, 160),
        description: String(raw.description || '').replace(/\s+/g, ' ').trim().slice(0, 240),
        status,
        remoteStatus: String(raw.remoteStatus || '').slice(0, 80),
        createdAt,
        updatedAt: validTimestamp(raw.updatedAt) || now,
        executionStartedAt: validTimestamp(raw.executionStartedAt) || createdAt,
        turn: Number.isSafeInteger(raw.turn) && raw.turn > 0 ? raw.turn : 1,
        error: String(raw.error || '').trim().slice(0, 1000),
        finalOutputOffset: Number.isSafeInteger(raw.finalOutputOffset) && raw.finalOutputOffset >= 0
            ? raw.finalOutputOffset
            : null,
        finalOutputLength: Number.isSafeInteger(raw.finalOutputLength) && raw.finalOutputLength > 0
            ? raw.finalOutputLength
            : 0,
        ...(raw.logRetention === 'full' ? { logRetention: 'full' } : {}),
        ...(continuation ? { continuation } : {}),
        ...(Number.isInteger(raw.pid) && raw.pid > 0 ? { pid: raw.pid } : {}),
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
            if (existing && task.turn < existing.turn) continue;
            if (existing && task.turn === existing.turn && task.remoteTaskId && existing.remoteTaskId
                && task.remoteTaskId !== existing.remoteTaskId) continue;
            if (existing && TERMINAL_STATUSES.has(existing.status) && task.status === 'ongoing'
                && task.turn <= existing.turn) {
                continue;
            }
            tasks.set(task.id, {
                ...existing,
                ...task,
                ...(existing?.continuation?.handle && !task.continuation?.handle
                    ? { continuation: existing.continuation }
                    : {}),
            });
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

function appendMetadata(journalPath, task) {
    fs.appendFileSync(journalPath, `${JSON.stringify(task)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function taskPaths(logDirectory, taskId) {
    if (!TASK_ID_RE.test(String(taskId || ''))) throw new Error('invalid_task_id');
    return {
        logPath: path.join(logDirectory, `${taskId}.log`),
        cursorPath: path.join(logDirectory, `${taskId}.cursor.json`),
    };
}

function atomicWriteJson(filePath, value) {
    assertSafeFile(filePath, path.dirname(filePath));
    const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
        fs.writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
        fs.renameSync(temporaryPath, filePath);
    } finally {
        try { fs.unlinkSync(temporaryPath); } catch (_) { }
    }
}

function readCursor(cursorPath) {
    try {
        const file = assertSafeFile(cursorPath, path.dirname(cursorPath));
        if (!file) return { tail: '', seq: null, sourceId: '' };
        const parsed = JSON.parse(fs.readFileSync(file.path, 'utf8'));
        return {
            tail: typeof parsed.tail === 'string' ? parsed.tail : '',
            seq: Number.isFinite(Number(parsed.seq)) ? Number(parsed.seq) : null,
            sourceId: typeof parsed.sourceId === 'string' ? parsed.sourceId.slice(0, 200) : '',
        };
    } catch (error) {
        if (error?.message === 'Task history storage is unsafe.') throw error;
        return { tail: '', seq: null, sourceId: '' };
    }
}

function overlapDelta(previousTail, nextTail) {
    if (!nextTail) return '';
    if (!previousTail) return nextTail;
    if (nextTail.startsWith(previousTail)) return nextTail.slice(previousTail.length);
    const maximum = Math.min(previousTail.length, nextTail.length);
    for (let size = maximum; size > 0; size -= 1) {
        if (previousTail.slice(-size) === nextTail.slice(0, size)) return nextTail.slice(size);
    }
    return `\n[task log source truncated or restarted]\n${nextTail}`;
}

function appendTaskLog(logPath, text, { retainFull = false } = {}) {
    if (!text) return '';
    assertSafeFile(logPath, path.dirname(logPath));
    fs.appendFileSync(logPath, text, { encoding: 'utf8', mode: 0o600 });
    const raw = fs.readFileSync(logPath);
    if (retainFull || raw.length <= MAX_LOG_BYTES) return text;
    const marker = Buffer.from('[older task log content truncated]\n', 'utf8');
    const kept = raw.subarray(Math.max(0, raw.length - (MAX_LOG_BYTES - marker.length)));
    fs.writeFileSync(logPath, Buffer.concat([marker, kept]), { mode: 0o600 });
    return text;
}

function ingestLog(logDirectory, task, rawLog = {}) {
    const { logPath, cursorPath } = taskPaths(logDirectory, task.id);
    const cursor = readCursor(cursorPath);
    const tail = typeof rawLog.tail === 'string' ? rawLog.tail : '';
    const seq = Number.isFinite(Number(rawLog.seq)) ? Number(rawLog.seq) : null;
    const sourceId = String(rawLog.sourceId || task.remoteTaskId || '').slice(0, 200);
    const sameSource = !sourceId || !cursor.sourceId || sourceId === cursor.sourceId;
    const appended = tail && (seq === null || cursor.seq === null || seq !== cursor.seq || tail !== cursor.tail)
        ? overlapDelta(sameSource ? cursor.tail : '', tail)
        : '';
    appendTaskLog(logPath, appended, { retainFull: task.logRetention === 'full' });
    atomicWriteJson(cursorPath, { tail, seq, sourceId, truncated: rawLog.truncated === true });
    let nextOffset = 0;
    try { nextOffset = fs.readFileSync(logPath, 'utf8').length; } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    return { appended, nextOffset };
}

function locateFinalOutput(logDirectory, taskId, finalOutput) {
    if (typeof finalOutput !== 'string' || !finalOutput) return { offset: null, length: 0 };
    const { logPath } = taskPaths(logDirectory, taskId);
    const file = assertSafeFile(logPath, logDirectory);
    const text = file ? fs.readFileSync(file.path, 'utf8') : '';
    for (const candidate of [finalOutput, finalOutput.trim()].filter(Boolean)) {
        const offset = text.lastIndexOf(candidate);
        if (offset >= 0) return { offset, length: candidate.length };
    }
    return { offset: null, length: 0 };
}

export function ingestTaskEvent(workingDir, envelope) {
    const { journalPath, logDirectory } = ensureTaskStorage(workingDir);
    const incoming = normalizeTask(envelope?.task);
    if (!incoming) throw new Error('invalid_task_event');
    const existing = readWorkspaceTasks(workingDir).find((task) => task.id === incoming.id) || null;
    const staleTurn = existing && incoming.turn < existing.turn;
    const staleSource = existing && incoming.turn === existing.turn
        && incoming.remoteTaskId && existing.remoteTaskId
        && incoming.remoteTaskId !== existing.remoteTaskId;
    const invalidRegression = existing && TERMINAL_STATUSES.has(existing.status)
        && incoming.status === 'ongoing' && incoming.turn <= existing.turn;
    let task = staleTurn || staleSource || invalidRegression ? existing : {
        ...existing,
        ...incoming,
        ...(existing?.continuation?.handle && !incoming.continuation?.handle
            ? { continuation: existing.continuation }
            : {}),
    };
    const logUpdate = envelope?.log
        ? ingestLog(logDirectory, task, { ...envelope.log, sourceId: task.remoteTaskId })
        : { appended: '', nextOffset: null };
    if (!staleTurn && !staleSource && !invalidRegression && TERMINAL_STATUSES.has(task.status)) {
        const finalOutput = locateFinalOutput(logDirectory, task.id, envelope?.finalOutput);
        task = { ...task, finalOutputOffset: finalOutput.offset, finalOutputLength: finalOutput.length };
    }
    const metadataChanged = !existing || JSON.stringify(existing) !== JSON.stringify(task);
    if (metadataChanged) appendMetadata(journalPath, task);
    return {
        task,
        logAppend: logUpdate.appended,
        ...(Number.isInteger(logUpdate.nextOffset) ? { logOffset: logUpdate.nextOffset } : {}),
    };
}

export function getTask(workingDir, taskId) {
    if (!TASK_ID_RE.test(String(taskId || ''))) throw new Error('invalid_task_id');
    return readWorkspaceTasks(workingDir).find((task) => task.id === taskId) || null;
}

export function readTaskLog(workingDir, taskId, offset = 0) {
    const storage = resolveTaskStorage(workingDir, { includeLogs: true });
    if (!storage?.logDirectory) return { text: '', nextOffset: 0, reset: false };
    const { logPath } = taskPaths(storage.logDirectory, taskId);
    const file = assertSafeFile(logPath, storage.logDirectory);
    const text = file ? fs.readFileSync(file.path, 'utf8') : '';
    const requested = Math.max(0, Number.parseInt(offset, 10) || 0);
    const reset = requested > text.length;
    const start = reset ? 0 : requested;
    return { text: text.slice(start), nextOffset: text.length, reset };
}

export function beginTaskContinuation(workingDir, taskId, { remoteTaskId, message, updatedAt } = {}) {
    const { journalPath, logDirectory } = ensureTaskStorage(workingDir);
    const existing = getTask(workingDir, taskId);
    if (!existing) throw new Error('task_not_found');
    if (!TERMINAL_STATUSES.has(existing.status)) throw new Error('task_not_terminal');
    if (!existing.continuation?.handle) throw new Error('task_not_continuable');
    const nextRemoteTaskId = String(remoteTaskId || '').trim().slice(0, 200);
    if (!nextRemoteTaskId || nextRemoteTaskId === existing.remoteTaskId) throw new Error('invalid_remote_task_id');
    const now = validTimestamp(updatedAt) || new Date().toISOString();
    const next = {
        ...existing,
        remoteTaskId: nextRemoteTaskId,
        status: 'ongoing',
        remoteStatus: 'pending',
        updatedAt: now,
        executionStartedAt: now,
        turn: existing.turn + 1,
        error: '',
        finalOutputOffset: null,
        finalOutputLength: 0,
        logRetention: 'full',
    };
    appendMetadata(journalPath, next);
    const { logPath, cursorPath } = taskPaths(logDirectory, taskId);
    appendTaskLog(logPath, `\n[Continuation ${next.turn}]\nUser: ${stripTerminalControls(message).trim()}\n\n`, { retainFull: true });
    atomicWriteJson(cursorPath, { tail: '', seq: null, sourceId: nextRemoteTaskId, truncated: false });
    return next;
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

export function formatWorkspaceTaskDetail(workingDir, taskId) {
    const task = userSafeTaskRead(() => getTask(workingDir, String(taskId || '').trim()));
    if (!task) throw new Error('Task not found.');
    const log = userSafeTaskRead(() => readTaskLog(workingDir, task.id));
    const name = task.description || task.toolName || task.id;
    const output = [
        `## ${escapeMarkdownInline(name)}`,
        '',
        `Task: ${task.id}`,
        `Status: ${task.status}`,
        `Remote status: ${task.remoteStatus || 'unknown'}`,
        `Agent: ${escapeMarkdownInline(task.targetAgent || 'unknown')}`,
        `Updated: ${formatTimestamp(task.updatedAt)}`,
    ];
    if (task.error) output.push(`Error: ${escapeMarkdownInline(task.error)}`);
    output.push('', '```text', safeLogFence(log.text || 'No log output yet.'), '```');
    return output.join('\n');
}

export function buildTaskCompletions(workingDir, action = 'view') {
    const tasks = readWorkspaceTasks(workingDir).filter((task) => {
        if (action === 'stop') return task.status === 'ongoing';
        if (action === 'continue') {
            return TERMINAL_STATUSES.has(task.status) && Boolean(task.continuation?.handle);
        }
        return true;
    });
    return tasks.map((task) => ({
        value: task.id,
        label: task.description || task.toolName || task.id,
        description: [task.status, task.remoteStatus, task.id].filter(Boolean).join(' · '),
    }));
}

export const __testables = {
    LOG_TAIL_BYTES,
    LOG_TAIL_LINES,
    MAX_TASK_LIMIT,
    MAX_LOG_BYTES,
    TERMINAL_STATUSES,
    capUtf8Tail,
    ensureTaskStorage,
    ingestLog,
    locateFinalOutput,
    normalizeContinuation,
    normalizeTask,
    overlapDelta,
    parseTaskLimit,
    readTaskLogTail,
    stripTerminalControls,
    userSafeTaskRead,
};
