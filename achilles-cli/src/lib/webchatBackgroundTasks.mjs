import crypto from 'node:crypto';
import {
    beginTaskContinuation,
    getTask,
    ingestTaskEvent,
    readOngoingTasks,
    readTaskLog,
    readWorkspaceTasks,
} from './workspaceTasks.mjs';

const TASK_POLL_INTERVAL_MS = 2000;
const DESCRIPTION_LIMIT = 240;

function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function localTaskId(targetAgent, remoteTaskId) {
    const digest = crypto.createHash('sha256')
        .update(`${targetAgent}\0${remoteTaskId}`)
        .digest('hex')
        .slice(0, 24);
    return `task_${digest}`;
}

function describeTask(agentName, toolName, args = {}) {
    const candidates = [
        args.taskDescription,
        args.description,
        args.prompt,
        args.query,
        args.task,
    ];
    const selected = candidates.map(trim).find(Boolean) || `${agentName}.${toolName}`;
    const compact = selected.replace(/\s+/g, ' ').trim();
    return compact.length > DESCRIPTION_LIMIT
        ? `${compact.slice(0, DESCRIPTION_LIMIT - 1)}…`
        : compact;
}

function normalizeStatus(status) {
    const value = trim(status).toLowerCase();
    if (value === 'completed') return 'finished';
    if (value === 'cancelled') return 'stopped';
    if (value === 'failed' || value === 'not_found') return 'error';
    return 'ongoing';
}

function normalizeContinuation(raw, targetAgent, fallbackTool = '') {
    if (!raw || typeof raw !== 'object' || raw.version !== 1) return null;
    const toolName = trim(raw.toolName) || trim(fallbackTool);
    const handle = trim(raw.handle);
    if (!toolName) return null;
    return {
        version: 1,
        targetAgent,
        toolName,
        ...(handle ? { handle } : {}),
    };
}

function emitTaskEvent(payload) {
    process.stdout.write(`${JSON.stringify({
        __webchatTask: 1,
        version: 1,
        ...payload,
    })}\n`);
}

function taskResultText(task) {
    const content = task?.result?.content;
    if (!Array.isArray(content)) return '';
    return content
        .filter((entry) => entry?.type === 'text' && typeof entry.text === 'string')
        .map((entry) => entry.text)
        .join('\n');
}

export async function createWebchatBackgroundTaskManager({
    workingDir,
    onTaskStarted = null,
    emitProtocol = true,
    onPublish = null,
    agentClientModule: providedAgentClientModule = null,
} = {}) {
    const agentClientModule = providedAgentClientModule || await import('/Agent/client/AgentMcpClient.mjs');
    if (typeof agentClientModule.setAgentTaskObserver !== 'function') {
        throw new Error('Ploinky AgentMcpClient does not support background task observers.');
    }

    const active = new Map();
    const taskStartWaiters = new Set();
    let pendingContinuation = null;
    let closed = false;

    const notifyTaskStarted = (record) => {
        for (const resolve of taskStartWaiters) resolve(record);
        taskStartWaiters.clear();
    };

    const publish = (payload, { persist = true } = {}) => {
        let outgoing = payload;
        if (persist && payload?.task) {
            const stored = ingestTaskEvent(workingDir, payload);
            outgoing = { ...payload, ...stored };
        }
        if (typeof onPublish === 'function') onPublish(outgoing);
        if (emitProtocol) emitTaskEvent(outgoing);
        return outgoing;
    };

    const schedulePoll = (record, getTaskStatus, delay = TASK_POLL_INTERVAL_MS) => {
        if (closed || record.terminal || record.timer) return;
        record.timer = setTimeout(() => {
            record.timer = null;
            void poll(record, getTaskStatus);
        }, delay);
    };

    const poll = async (record, getTaskStatus) => {
        if (closed || record.terminal) return;
        try {
            const task = await getTaskStatus();
            const remoteStatus = trim(task?.status) || 'running';
            const status = normalizeStatus(remoteStatus);
            const logSeq = Number.isFinite(Number(task?.logSeq)) ? Number(task.logSeq) : null;
            const changed = record.remoteStatus !== remoteStatus || record.logSeq !== logSeq;
            record.remoteStatus = remoteStatus;
            record.logSeq = logSeq;
            record.status = status;
            const resultContinuation = normalizeContinuation(
                task?.result?.metadata?.continuation,
                record.targetAgent,
                record.continuation?.toolName,
            );
            if (resultContinuation?.handle) record.continuation = resultContinuation;
            if (changed) {
                const finalOutput = status === 'ongoing' ? '' : taskResultText(task);
                publish({
                    event: 'update',
                    task: {
                        id: record.id,
                        targetAgent: record.targetAgent,
                        remoteTaskId: record.remoteTaskId,
                        toolName: record.toolName,
                        description: record.description,
                        status,
                        remoteStatus,
                        createdAt: record.createdAt,
                        updatedAt: task?.updatedAt || new Date().toISOString(),
                        executionStartedAt: record.executionStartedAt,
                        turn: record.turn,
                        error: trim(task?.error),
                        ...(record.continuation ? { continuation: record.continuation } : {}),
                        ...(record.logRetention === 'full' ? { logRetention: 'full' } : {}),
                    },
                    log: {
                        tail: typeof task?.logTail === 'string' ? task.logTail : '',
                        seq: logSeq,
                        truncated: task?.logTruncated === true,
                    },
                    ...(finalOutput ? { finalOutput } : {}),
                });
            }
            if (status !== 'ongoing') {
                record.terminal = true;
                active.delete(record.id);
                return;
            }
        } catch (error) {
            const message = trim(error?.message).toLowerCase();
            if (message.includes('not_found') || message.includes('task not found') || message.includes('status 404')) {
                record.status = 'error';
                record.terminal = true;
                active.delete(record.id);
                publish({
                    event: 'update',
                    task: {
                        ...record,
                        timer: undefined,
                        terminal: undefined,
                        status: 'error',
                        remoteStatus: 'not_found',
                        updatedAt: new Date().toISOString(),
                        error: 'Task not found on target agent.',
                    },
                });
                return;
            }
        }
        schedulePoll(record, getTaskStatus);
    };

    const watch = ({ agentName, taskId, toolName, arguments: args, metadata, getTaskStatus }, existing = null) => {
        const id = existing?.id || localTaskId(agentName, taskId);
        if (active.has(id)) {
            return active.get(id);
        }
        const now = new Date().toISOString();
        const continuation = existing?.continuation || normalizeContinuation(
            metadata?.continuationCapability,
            agentName,
        );
        const record = {
            id,
            targetAgent: agentName,
            remoteTaskId: taskId,
            toolName: trim(toolName) || trim(metadata?.toolName),
            description: existing?.description || describeTask(agentName, toolName, args),
            status: 'ongoing',
            remoteStatus: trim(metadata?.status) || existing?.remoteStatus || 'pending',
            createdAt: existing?.createdAt || metadata?.createdAt || now,
            updatedAt: metadata?.updatedAt || now,
            executionStartedAt: existing?.executionStartedAt || metadata?.createdAt || now,
            turn: existing?.turn || 1,
            logSeq: null,
            continuation,
            logRetention: metadata?.logRetention === 'full' || existing?.logRetention === 'full'
                ? 'full'
                : 'bounded',
            terminal: false,
            timer: null,
        };
        active.set(id, record);
        const conversation = !existing && typeof onTaskStarted === 'function'
            ? onTaskStarted(record)
            : null;
        publish({ event: existing ? 'reattached' : 'started', task: {
            id: record.id,
            targetAgent: record.targetAgent,
            remoteTaskId: record.remoteTaskId,
            toolName: record.toolName,
            description: record.description,
            status: record.status,
            remoteStatus: record.remoteStatus,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            executionStartedAt: record.executionStartedAt,
            turn: record.turn,
            error: '',
            ...(record.continuation ? { continuation: record.continuation } : {}),
            ...(record.logRetention === 'full' ? { logRetention: 'full' } : {}),
        }, ...(conversation ? {
            sessionId: conversation.session?.sessionId,
            messageIndex: conversation.messageIndex,
        } : {}) });
        if (!existing) notifyTaskStarted(record);
        schedulePoll(record, getTaskStatus, 0);
        return record;
    };

    const removeObserver = agentClientModule.setAgentTaskObserver(async (task) => {
        let existing = null;
        let continuationLog = null;
        let continuesPendingTask = false;
        if (pendingContinuation
            && pendingContinuation.targetAgent === task.agentName
            && pendingContinuation.toolName === task.toolName
            && pendingContinuation.handle === trim(task.arguments?.handle)) {
            const previousLogOffset = readTaskLog(
                workingDir,
                pendingContinuation.taskId,
            ).nextOffset;
            existing = beginTaskContinuation(workingDir, pendingContinuation.taskId, {
                remoteTaskId: task.taskId,
                message: pendingContinuation.message,
                updatedAt: task.metadata?.updatedAt,
            });
            continuationLog = readTaskLog(
                workingDir,
                pendingContinuation.taskId,
                previousLogOffset,
            );
            continuesPendingTask = true;
        }
        const record = watch(task, existing);
        if (continuesPendingTask) {
            pendingContinuation.startedTask = getTask(workingDir, record.id) || record;
            publish({
                event: 'continued',
                task: pendingContinuation.startedTask,
                logAppend: continuationLog?.text || '',
                logOffset: continuationLog?.nextOffset || 0,
            }, { persist: false });
        }
        return {
            detached: true,
            id: record.id,
            description: record.description,
        };
    });

    const reattachTimer = setTimeout(() => {
        if (closed) return;
        let ongoingTasks = [];
        try {
            ongoingTasks = readOngoingTasks(workingDir);
        } catch (error) {
            console.warn(`[webchat-tasks] Unable to read task journal: ${error.message}`);
            return;
        }
        for (const task of ongoingTasks) {
            void agentClientModule.createAgentClient(task.targetAgent).then(async (client) => {
                await client.ensureAgentRunning(task.targetAgent, { mode: 'global' });
                watch({
                    agentName: task.targetAgent,
                    taskId: task.remoteTaskId,
                    toolName: task.toolName,
                    arguments: { description: task.description },
                    metadata: task,
                    getTaskStatus: () => client.getTaskStatus(task.remoteTaskId),
                }, task);
            }).catch((error) => {
                console.warn(`[webchat-tasks] Unable to reattach ${task.id}: ${error.message}`);
            });
        }
    }, 250);

    return {
        activeCount: () => active.size,
        createTaskStartWaiter() {
            let resolveWaiter;
            const promise = new Promise((resolve) => {
                resolveWaiter = resolve;
            });
            taskStartWaiters.add(resolveWaiter);
            return {
                promise,
                cancel() {
                    taskStartWaiters.delete(resolveWaiter);
                },
            };
        },
        listTasks() {
            const tasks = readWorkspaceTasks(workingDir);
            publish({ event: 'list', tasks }, { persist: false });
            return tasks;
        },
        viewTask(taskId) {
            const task = getTask(workingDir, taskId);
            if (!task) throw new Error('task_not_found');
            const log = readTaskLog(workingDir, taskId);
            publish({ event: 'view', task, log }, { persist: false });
            return { task, log };
        },
        async stopTask(taskId) {
            const task = getTask(workingDir, taskId);
            if (!task) throw new Error('task_not_found');
            if (task.status !== 'ongoing') throw new Error('task_not_running');
            const client = await agentClientModule.createAgentClient(task.targetAgent);
            const remote = await client.cancelTask(task.remoteTaskId);
            const updated = {
                ...task,
                status: normalizeStatus(remote?.status),
                remoteStatus: trim(remote?.status) || task.remoteStatus,
                updatedAt: remote?.updatedAt || new Date().toISOString(),
                error: trim(remote?.error),
            };
            const outgoing = publish({ event: 'update', task: updated });
            const record = active.get(taskId);
            if (record) {
                record.status = outgoing.task.status;
                record.remoteStatus = outgoing.task.remoteStatus;
                record.updatedAt = outgoing.task.updatedAt;
                record.error = outgoing.task.error;
                if (outgoing.task.status !== 'ongoing') {
                    record.terminal = true;
                    if (record.timer) clearTimeout(record.timer);
                    record.timer = null;
                }
            }
            if (outgoing.task.status !== 'ongoing') active.delete(taskId);
            publish({ event: 'action', action: 'stop', ok: true, task: outgoing.task }, { persist: false });
            return outgoing.task;
        },
        async continueTask(taskId, message) {
            const task = getTask(workingDir, taskId);
            if (!task) throw new Error('task_not_found');
            if (task.status === 'ongoing') throw new Error('task_not_terminal');
            if (!task.continuation?.handle) throw new Error('task_not_continuable');
            const prompt = trim(message);
            if (!prompt) throw new Error('continuation_message_required');
            const client = await agentClientModule.createAgentClient(task.continuation.targetAgent);
            await client.ensureAgentRunning(task.continuation.targetAgent, { mode: 'global' });
            pendingContinuation = {
                taskId,
                targetAgent: task.continuation.targetAgent,
                toolName: task.continuation.toolName,
                handle: task.continuation.handle,
                message: prompt,
                startedTask: null,
            };
            try {
                await client.callToolWithoutWait(task.continuation.toolName, {
                    handle: task.continuation.handle,
                    prompt,
                });
                if (!pendingContinuation.startedTask) throw new Error('continuation_did_not_start_task');
                publish({
                    event: 'action',
                    action: 'continue',
                    ok: true,
                    task: pendingContinuation.startedTask,
                }, { persist: false });
                return pendingContinuation.startedTask;
            } finally {
                pendingContinuation = null;
            }
        },
        reportActionError(action, taskId, error) {
            let task = null;
            try { task = getTask(workingDir, taskId); } catch (_) { }
            if (!task) return;
            publish({
                event: 'action',
                action,
                ok: false,
                task,
                error: trim(error?.message || error) || 'task_action_failed',
            }, { persist: false });
        },
        close() {
            closed = true;
            clearTimeout(reattachTimer);
            removeObserver();
            for (const record of active.values()) {
                if (record.timer) clearTimeout(record.timer);
            }
            taskStartWaiters.clear();
            active.clear();
        },
    };
}

export const __testables = {
    TASK_POLL_INTERVAL_MS,
    describeTask,
    localTaskId,
    normalizeStatus,
    normalizeContinuation,
    taskResultText,
    readOngoingTasks,
};
