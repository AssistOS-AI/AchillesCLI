import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    __testables,
    createWebchatBackgroundTaskManager,
} from '../src/lib/webchatBackgroundTasks.mjs';
import {
    getTask,
    ingestTaskEvent,
    readTaskLog,
} from '../src/lib/workspaceTasks.mjs';

test('detached WebChat tasks poll remote status every two seconds', () => {
    assert.equal(__testables.TASK_POLL_INTERVAL_MS, 2000);
});

test('background task ids are stable per target agent and remote task', () => {
    const first = __testables.localTaskId('opencodeAgent', 'abc');
    assert.equal(first, __testables.localTaskId('opencodeAgent', 'abc'));
    assert.notEqual(first, __testables.localTaskId('piAgent', 'abc'));
    assert.match(first, /^task_[0-9a-f]{24}$/);
});

test('task descriptions prefer prompt-like arguments and remain bounded', () => {
    assert.equal(
        __testables.describeTask('agent', 'execute', { prompt: '  build\n  the project  ' }),
        'build the project',
    );
    assert.equal(__testables.describeTask('agent', 'execute', {}), 'agent.execute');
    assert.ok(__testables.describeTask('agent', 'execute', { query: 'x'.repeat(400) }).length <= 240);
});

test('ongoing task restoration ignores malformed lines and terminal tasks', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-task-journal-'));
    const history = path.join(workspace, '.achilles-cli', 'tasks');
    fs.mkdirSync(history, { recursive: true });
    const ongoingId = 'task_aaaaaaaaaaaaaaaaaaaaaaaa';
    const finishedId = 'task_bbbbbbbbbbbbbbbbbbbbbbbb';
    fs.writeFileSync(path.join(history, 'agent_tasks'), [
        JSON.stringify({ id: ongoingId, targetAgent: 'one', remoteTaskId: '1', status: 'ongoing' }),
        '{partial',
        JSON.stringify({ id: finishedId, targetAgent: 'two', remoteTaskId: '2', status: 'finished' }),
        '',
    ].join('\n'));
    const tasks = __testables.readOngoingTasks(workspace);
    assert.deepEqual(tasks.map((task) => task.id), [ongoingId]);
});

test('remote task statuses map to the four WebChat states', () => {
    assert.equal(__testables.normalizeStatus('pending'), 'ongoing');
    assert.equal(__testables.normalizeStatus('running'), 'ongoing');
    assert.equal(__testables.normalizeStatus('completed'), 'finished');
    assert.equal(__testables.normalizeStatus('cancelled'), 'stopped');
    assert.equal(__testables.normalizeStatus('failed'), 'error');
});

test('continuation metadata binds the provider tool and opaque handle to its target agent', () => {
    assert.deepEqual(__testables.normalizeContinuation({
        version: 1,
        toolName: 'continue-task',
        handle: 'opaque-session-handle',
    }, 'opencodeAgent'), {
        version: 1,
        targetAgent: 'opencodeAgent',
        toolName: 'continue-task',
        handle: 'opaque-session-handle',
    });
    assert.deepEqual(__testables.normalizeContinuation({
        version: 1,
    }, 'piAgent', 'continue-task'), {
        version: 1,
        targetAgent: 'piAgent',
        toolName: 'continue-task',
    });
});

test('terminal task result text is exposed separately from the live log', () => {
    assert.equal(__testables.taskResultText({
        result: {
            content: [
                { type: 'text', text: 'Final answer' },
                { type: 'image', data: 'ignored' },
            ],
        },
    }), 'Final answer');
    assert.equal(__testables.taskResultText({ result: null }), '');
});

test('AchillesCLI manager stops and continues tasks through agent commands', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-task-actions-'));
    const ongoingId = 'task_111111111111111111111111';
    const finishedId = 'task_222222222222222222222222';
    const createdAt = '2026-07-23T10:00:00.000Z';
    let observer = null;
    const calls = [];
    const published = [];
    const agentClientModule = {
        setAgentTaskObserver(next) {
            observer = next;
            return () => { observer = null; };
        },
        async createAgentClient(agentName) {
            calls.push(['client', agentName]);
            return {
                async cancelTask(remoteTaskId) {
                    calls.push(['cancel', remoteTaskId]);
                    return { id: remoteTaskId, status: 'cancelled', updatedAt: createdAt };
                },
                async ensureAgentRunning(targetAgent, options) {
                    calls.push(['ensure', targetAgent, options]);
                },
                async callToolWithoutWait(toolName, args) {
                    calls.push(['continue', toolName, args]);
                    await observer({
                        agentName,
                        taskId: 'remote-next',
                        toolName,
                        arguments: args,
                        metadata: { status: 'queued', createdAt, updatedAt: createdAt },
                        getTaskStatus: async () => ({ id: 'remote-next', status: 'queued' }),
                    });
                },
            };
        },
    };

    try {
        ingestTaskEvent(workspace, { task: {
            id: ongoingId,
            targetAgent: 'worker',
            remoteTaskId: 'remote-running',
            toolName: 'run-task',
            status: 'ongoing',
            remoteStatus: 'queued',
            createdAt,
            updatedAt: createdAt,
        } });
        ingestTaskEvent(workspace, { task: {
            id: finishedId,
            targetAgent: 'worker',
            remoteTaskId: 'remote-finished',
            toolName: 'run-task',
            status: 'finished',
            remoteStatus: 'completed',
            createdAt,
            updatedAt: createdAt,
            continuation: {
                version: 1,
                targetAgent: 'worker',
                toolName: 'continue-task',
                handle: 'opaque-task-handle',
            },
        } });

        const manager = await createWebchatBackgroundTaskManager({
            workingDir: workspace,
            emitProtocol: false,
            onPublish: (event) => published.push(event),
            agentClientModule,
        });
        try {
            const stopped = await manager.stopTask(ongoingId);
            assert.equal(stopped.status, 'stopped');
            assert.equal(stopped.remoteStatus, 'cancelled');

            const continued = await manager.continueTask(finishedId, 'finish the tests');
            assert.equal(continued.id, finishedId);
            assert.equal(continued.turn, 2);
            assert.equal(continued.status, 'ongoing');
            assert.equal(continued.remoteStatus, 'queued');
            assert.equal(getTask(workspace, finishedId).remoteTaskId, 'remote-next');
            assert.match(readTaskLog(workspace, finishedId).text, /User: finish the tests/);
            const continuationEvent = published.find((event) => event.event === 'continued');
            assert.equal(continuationEvent.task.id, finishedId);
            assert.match(continuationEvent.logAppend, /\[Continuation 2\]/);
            assert.match(continuationEvent.logAppend, /User: finish the tests/);
            assert.equal(continuationEvent.logOffset, readTaskLog(workspace, finishedId).nextOffset);
        } finally {
            manager.close();
        }
        assert.deepEqual(calls, [
            ['client', 'worker'],
            ['cancel', 'remote-running'],
            ['client', 'worker'],
            ['ensure', 'worker', { mode: 'global' }],
            ['continue', 'continue-task', { handle: 'opaque-task-handle', prompt: 'finish the tests' }],
        ]);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('a completed continuation persists its terminal state on the current turn', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-task-continuation-'));
    const taskId = 'task_333333333333333333333333';
    const createdAt = '2026-07-23T10:00:00.000Z';
    const continuationStartedAt = '2026-07-24T06:39:10.000Z';
    const completedAt = '2026-07-24T06:39:14.000Z';
    let observer = null;
    const agentClientModule = {
        setAgentTaskObserver(next) {
            observer = next;
            return () => { observer = null; };
        },
        async createAgentClient(agentName) {
            return {
                async ensureAgentRunning() { },
                async callToolWithoutWait(toolName, args) {
                    await observer({
                        agentName,
                        taskId: 'remote-turn-two',
                        toolName,
                        arguments: args,
                        metadata: {
                            status: 'queued',
                            createdAt: continuationStartedAt,
                            updatedAt: continuationStartedAt,
                        },
                        getTaskStatus: async () => ({
                            id: 'remote-turn-two',
                            status: 'completed',
                            updatedAt: completedAt,
                            logTail: 'Done.',
                            logSeq: 1,
                            result: { content: [{ type: 'text', text: 'Done.' }] },
                        }),
                    });
                },
            };
        },
    };

    try {
        ingestTaskEvent(workspace, { task: {
            id: taskId,
            targetAgent: 'worker',
            remoteTaskId: 'remote-turn-one',
            toolName: 'run-task',
            status: 'finished',
            remoteStatus: 'completed',
            createdAt,
            updatedAt: createdAt,
            turn: 1,
            continuation: {
                version: 1,
                targetAgent: 'worker',
                toolName: 'continue-task',
                handle: 'opaque-task-handle',
            },
        } });

        const manager = await createWebchatBackgroundTaskManager({
            workingDir: workspace,
            emitProtocol: false,
            agentClientModule,
        });
        try {
            const continued = await manager.continueTask(taskId, 'continue');
            assert.equal(continued.turn, 2);

            let stored = getTask(workspace, taskId);
            const deadline = Date.now() + 500;
            while (stored?.status !== 'finished' && Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 5));
                stored = getTask(workspace, taskId);
            }

            assert.equal(stored.status, 'finished');
            assert.equal(stored.remoteStatus, 'completed');
            assert.equal(stored.remoteTaskId, 'remote-turn-two');
            assert.equal(stored.turn, 2);
            assert.equal(stored.createdAt, createdAt);
            assert.equal(stored.executionStartedAt, continuationStartedAt);
            assert.equal(stored.updatedAt, completedAt);
        } finally {
            manager.close();
        }
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('reattachment starts a manual target agent before polling its task', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-task-reattach-'));
    const taskId = 'task_444444444444444444444444';
    const createdAt = '2026-07-24T07:00:00.000Z';
    let targetRunning = false;
    const calls = [];
    const agentClientModule = {
        setAgentTaskObserver() {
            return () => { };
        },
        async createAgentClient(agentName) {
            calls.push(['client', agentName]);
            return {
                async ensureAgentRunning(targetAgent, options) {
                    calls.push(['ensure', targetAgent, options]);
                    targetRunning = true;
                },
                async getTaskStatus(remoteTaskId) {
                    assert.equal(targetRunning, true);
                    calls.push(['status', remoteTaskId]);
                    return {
                        id: remoteTaskId,
                        status: 'completed',
                        updatedAt: createdAt,
                    };
                },
            };
        },
    };

    try {
        ingestTaskEvent(workspace, { task: {
            id: taskId,
            targetAgent: 'manual-worker',
            remoteTaskId: 'remote-running',
            toolName: 'run-task',
            status: 'ongoing',
            remoteStatus: 'running',
            createdAt,
            updatedAt: createdAt,
        } });

        const manager = await createWebchatBackgroundTaskManager({
            workingDir: workspace,
            emitProtocol: false,
            agentClientModule,
        });
        try {
            let stored = getTask(workspace, taskId);
            const deadline = Date.now() + 750;
            while (stored?.status !== 'finished' && Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 10));
                stored = getTask(workspace, taskId);
            }

            assert.equal(stored.status, 'finished');
            assert.deepEqual(calls, [
                ['client', 'manual-worker'],
                ['ensure', 'manual-worker', { mode: 'global' }],
                ['status', 'remote-running'],
            ]);
        } finally {
            manager.close();
        }
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});
