import crypto from 'node:crypto';
import { readOngoingTasks } from './workspaceTasks.mjs';

const TASK_POLL_INTERVAL_MS = 5000;
const DESCRIPTION_LIMIT = 240;
const RESULT_LIMIT = 256 * 1024;

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

function resultText(result) {
    if (result === undefined || result === null) return '';
    let text = '';
    if (typeof result === 'string') {
        text = result;
    } else {
        const content = Array.isArray(result?.content) ? result.content : [];
        text = content
            .filter((entry) => entry?.type === 'text' && typeof entry.text === 'string')
            .map((entry) => entry.text)
            .join('\n');
        if (!text) {
            try {
                text = JSON.stringify(result, null, 2);
            } catch (_) {
                text = String(result);
            }
        }
    }
    return text.length > RESULT_LIMIT ? text.slice(text.length - RESULT_LIMIT) : text;
}

function emitTaskEvent(payload) {
    process.stdout.write(`${JSON.stringify({
        __webchatTask: 1,
        version: 1,
        ...payload,
    })}\n`);
}

export async function createWebchatBackgroundTaskManager({ workingDir }) {
    const agentClientModule = await import('/Agent/client/AgentMcpClient.mjs');
    if (typeof agentClientModule.setAgentTaskObserver !== 'function') {
        throw new Error('Ploinky AgentMcpClient does not support background task observers.');
    }

    const active = new Map();
    let closed = false;

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
            if (changed) {
                emitTaskEvent({
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
                        error: trim(task?.error),
                    },
                    log: {
                        tail: typeof task?.logTail === 'string' ? task.logTail : '',
                        seq: logSeq,
                        truncated: task?.logTruncated === true,
                        result: status === 'finished' ? resultText(task?.result) : '',
                    },
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
                emitTaskEvent({
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
        const record = {
            id,
            targetAgent: agentName,
            remoteTaskId: taskId,
            toolName: trim(toolName) || trim(metadata?.toolName),
            description: existing?.description || describeTask(agentName, toolName, args),
            status: 'ongoing',
            remoteStatus: trim(metadata?.status) || existing?.remoteStatus || 'pending',
            createdAt: metadata?.createdAt || existing?.createdAt || now,
            updatedAt: metadata?.updatedAt || now,
            logSeq: null,
            terminal: false,
            timer: null,
        };
        active.set(id, record);
        emitTaskEvent({ event: existing ? 'reattached' : 'started', task: {
            id: record.id,
            targetAgent: record.targetAgent,
            remoteTaskId: record.remoteTaskId,
            toolName: record.toolName,
            description: record.description,
            status: record.status,
            remoteStatus: record.remoteStatus,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
            error: '',
        } });
        schedulePoll(record, getTaskStatus, 0);
        return record;
    };

    const removeObserver = agentClientModule.setAgentTaskObserver(async (task) => {
        const record = watch(task);
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
            void agentClientModule.createAgentClient(task.targetAgent).then((client) => {
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
        close() {
            closed = true;
            clearTimeout(reattachTimer);
            removeObserver();
            for (const record of active.values()) {
                if (record.timer) clearTimeout(record.timer);
            }
            active.clear();
        },
    };
}

export const __testables = {
    describeTask,
    localTaskId,
    normalizeStatus,
    readOngoingTasks,
};
