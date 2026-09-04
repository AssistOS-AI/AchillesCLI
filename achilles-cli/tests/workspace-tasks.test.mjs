import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { SlashCommandHandler } from '../src/repl/SlashCommandHandler.mjs';
import { getQuickReference, showHelp } from '../src/ui/HelpSystem.mjs';
import {
    __testables,
    appendTaskLogEntry,
    beginTaskContinuation,
    buildTaskCompletions,
    formatWorkspaceTaskDetail,
    formatWorkspaceTaskSummary,
    getTask,
    ingestTaskEvent,
    readTaskLog,
    readOngoingTasks,
    readWorkspaceTasks,
    setTaskModel,
} from '../src/lib/workspaceTasks.mjs';

const FINISHED_ID = 'task_111111111111111111111111';
const ONGOING_ID = 'task_222222222222222222222222';
const ERROR_ID = 'task_333333333333333333333333';

function makeWorkspace(label) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `achilles-tasks-${label}-`));
    const history = path.join(workspace, '.data', 'achilles-cli', 'tasks');
    const logs = path.join(history, 'task_logs');
    fs.mkdirSync(logs, { recursive: true });
    return { workspace, history, logs };
}

function writeJournal(history, entries) {
    fs.writeFileSync(path.join(history, 'agent_tasks'), `${entries.join('\n')}\n`);
}

test('workspace task reader materializes latest safe state in update order', () => {
    const fixture = makeWorkspace('reader');
    try {
        writeJournal(fixture.history, [
            JSON.stringify({
                id: FINISHED_ID,
                targetAgent: 'opencodeAgent',
                remoteTaskId: 'remote-1',
                description: 'Build the project',
                status: 'ongoing',
                updatedAt: '2026-07-14T10:00:00.000Z',
            }),
            '{partial',
            JSON.stringify({
                id: FINISHED_ID,
                targetAgent: 'opencodeAgent',
                remoteTaskId: 'remote-1',
                description: 'Build the project',
                status: 'finished',
                updatedAt: '2026-07-14T11:00:00.000Z',
            }),
            JSON.stringify({
                id: FINISHED_ID,
                targetAgent: 'opencodeAgent',
                remoteTaskId: 'remote-1',
                description: 'Build the project',
                status: 'ongoing',
                updatedAt: '2026-07-14T12:00:00.000Z',
            }),
            JSON.stringify({
                id: ONGOING_ID,
                targetAgent: 'GPTResearcher',
                remoteTaskId: 'remote-2',
                description: 'Research dependencies',
                status: 'ongoing',
                updatedAt: '2026-07-14T11:30:00.000Z',
            }),
        ]);

        const tasks = readWorkspaceTasks(fixture.workspace);
        assert.deepEqual(tasks.map((task) => task.id), [ONGOING_ID, FINISHED_ID]);
        assert.equal(tasks[1].status, 'finished');
        assert.deepEqual(readOngoingTasks(fixture.workspace).map((task) => task.id), [ONGOING_ID]);
    } finally {
        fs.rmSync(fixture.workspace, { recursive: true, force: true });
    }
});

test('workspace task reader accumulates legacy final-output ranges across continuations', () => {
    const fixture = makeWorkspace('legacy-final-ranges');
    try {
        writeJournal(fixture.history, [
            JSON.stringify({
                id: FINISHED_ID,
                targetAgent: 'opencodeAgent',
                remoteTaskId: 'remote-1',
                status: 'finished',
                turn: 1,
                finalOutputOffset: 20,
                finalOutputLength: 12,
            }),
            JSON.stringify({
                id: FINISHED_ID,
                targetAgent: 'opencodeAgent',
                remoteTaskId: 'remote-2',
                status: 'ongoing',
                turn: 2,
                finalOutputOffset: null,
                finalOutputLength: 0,
            }),
            JSON.stringify({
                id: FINISHED_ID,
                targetAgent: 'opencodeAgent',
                remoteTaskId: 'remote-2',
                status: 'finished',
                turn: 2,
                finalOutputOffset: 80,
                finalOutputLength: 14,
            }),
        ]);

        assert.deepEqual(getTask(fixture.workspace, FINISHED_ID).finalOutputRanges, [
            { turn: 1, offset: 20, length: 12 },
            { turn: 2, offset: 80, length: 14 },
        ]);
    } finally {
        fs.rmSync(fixture.workspace, { recursive: true, force: true });
    }
});

test('task model override is appended to the task journal and survives continuation state', () => {
    const fixture = makeWorkspace('task-model');
    try {
        writeJournal(fixture.history, [JSON.stringify({
            id: FINISHED_ID,
            targetAgent: 'piAgent',
            remoteTaskId: 'remote-1',
            toolName: 'execute-task',
            status: 'finished',
            continuation: {
                version: 1,
                targetAgent: 'piAgent',
                toolName: 'continue-task',
                handle: 'opaque-task-handle',
            },
        })]);
        const updated = setTaskModel(fixture.workspace, FINISHED_ID, {
            key: 'openai/gpt-test',
            provider: 'openai',
            model: 'gpt-test',
            label: 'GPT Test',
        });
        assert.deepEqual(updated.execution.model, {
            key: 'openai/gpt-test',
            provider: 'openai',
            model: 'gpt-test',
            label: 'GPT Test',
        });
        assert.equal(updated.logAppend, 'switched model to: GPT Test\n');
        assert.equal(updated.logOffset, updated.logAppend.length);
        assert.equal(readTaskLog(fixture.workspace, FINISHED_ID).text, updated.logAppend);
        assert.deepEqual(getTask(fixture.workspace, FINISHED_ID).execution, updated.execution);
    } finally {
        fs.rmSync(fixture.workspace, { recursive: true, force: true });
    }
});

test('task control messages are appended to persistent task logs', () => {
    const fixture = makeWorkspace('task-control-log');
    try {
        writeJournal(fixture.history, [JSON.stringify({
            id: FINISHED_ID,
            targetAgent: 'codexAgent',
            remoteTaskId: 'remote-1',
            status: 'finished',
        })]);
        const updated = appendTaskLogEntry(
            fixture.workspace,
            FINISHED_ID,
            'Authentication successful',
        );
        assert.equal(updated.logAppend, 'Authentication successful\n');
        assert.equal(updated.logOffset, updated.logAppend.length);
        assert.equal(readTaskLog(fixture.workspace, FINISHED_ID).text, updated.logAppend);
    } finally {
        fs.rmSync(fixture.workspace, { recursive: true, force: true });
    }
});

test('task summary defaults to ten, supports count and all, and shows only terminal log tails', () => {
    const fixture = makeWorkspace('summary');
    try {
        writeJournal(fixture.history, [
            JSON.stringify({
                id: FINISHED_ID,
                targetAgent: 'opencodeAgent',
                remoteTaskId: 'remote-1',
                description: 'Build **the** project',
                status: 'finished',
                updatedAt: '2026-07-14T12:00:00.000Z',
            }),
            JSON.stringify({
                id: ONGOING_ID,
                targetAgent: 'GPTResearcher',
                remoteTaskId: 'remote-2',
                description: 'Research dependencies',
                status: 'ongoing',
                updatedAt: '2026-07-14T13:00:00.000Z',
            }),
            JSON.stringify({
                id: ERROR_ID,
                targetAgent: 'piAgent',
                remoteTaskId: 'remote-3',
                toolName: 'execute-task',
                status: 'error',
                error: 'runner failed',
                updatedAt: '2026-07-14T11:00:00.000Z',
            }),
        ]);
        fs.writeFileSync(path.join(fixture.logs, `${FINISHED_ID}.log`), [
            'line 1',
            'line 2',
            'line 3',
            '\u001b[31mline 4\u001b[0m',
            'line 5',
            'line 6 with ``` fence',
            'line 7',
            '',
        ].join('\n'));
        fs.writeFileSync(path.join(fixture.logs, `${ONGOING_ID}.log`), 'live log must stay hidden\n');

        const summary = formatWorkspaceTaskSummary(fixture.workspace);
        assert.match(summary, /Showing all 3 tasks\./);
        assert.match(summary, /\*\*ongoing\*\* — Research dependencies/);
        assert.match(summary, /\*\*finished\*\* — Build \\\*\\\*the\\\*\\\* project/);
        assert.match(summary, /Agent: opencodeAgent · Updated: 2026-07-14 12:00:00Z/);
        assert.match(summary, /\[earlier log output omitted\]/);
        assert.doesNotMatch(summary, /line 1|line 2|live log must stay hidden|\u001b/);
        assert.match(summary, /line 3[\s\S]*line 7/);
        assert.match(summary, /Error: runner failed/);

        const one = formatWorkspaceTaskSummary(fixture.workspace, '1');
        assert.match(one, /Showing 1 of 3 tasks\./);
        assert.match(one, /Research dependencies/);
        assert.doesNotMatch(one, /Build/);
        assert.match(formatWorkspaceTaskSummary(fixture.workspace, 'all'), /Showing all 3 tasks\./);
        assert.throws(() => formatWorkspaceTaskSummary(fixture.workspace, '0'), /between 1 and 100/);
        assert.throws(() => formatWorkspaceTaskSummary(fixture.workspace, '101'), /between 1 and 100/);
        assert.throws(() => formatWorkspaceTaskSummary(fixture.workspace, 'recent'), /Usage: \/tasks/);

        const detail = formatWorkspaceTaskDetail(fixture.workspace, FINISHED_ID);
        assert.match(detail, /^## Build \\\*\\\*the\\\*\\\* project/m);
        assert.match(detail, /Status: finished/);
        assert.match(detail, /Latest log:/);
        assert.match(detail, /\[earlier log output omitted\]/);
        assert.doesNotMatch(detail, /line 1|line 2|\u001b/);
        assert.match(detail, /line 3[\s\S]*line 7/);
    } finally {
        fs.rmSync(fixture.workspace, { recursive: true, force: true });
    }
});

test('task summary is read-only for missing history and rejects symlinked task storage', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-tasks-safe-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-tasks-outside-'));
    try {
        assert.equal(
            formatWorkspaceTaskSummary(workspace),
            'No background tasks found for this workspace.',
        );
        assert.equal(fs.existsSync(path.join(workspace, '.data', 'achilles-cli', 'tasks')), false);
        const missingWorkspace = path.join(workspace, 'missing');
        assert.throws(
            () => formatWorkspaceTaskSummary(missingWorkspace),
            (error) => error.message === 'Unable to read task history (ENOENT).',
        );
        fs.mkdirSync(path.join(workspace, '.data', 'achilles-cli'), { recursive: true });
        fs.symlinkSync(outside, path.join(workspace, '.data', 'achilles-cli', 'tasks'), 'dir');
        assert.throws(() => formatWorkspaceTaskSummary(workspace), /storage is unsafe/);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    }
});

test('terminal log reader rejects symlinked task log files', () => {
    const fixture = makeWorkspace('log-symlink');
    const outside = path.join(fixture.workspace, 'outside.log');
    try {
        writeJournal(fixture.history, [JSON.stringify({
            id: FINISHED_ID,
            targetAgent: 'opencodeAgent',
            remoteTaskId: 'remote-1',
            description: 'Build project',
            status: 'finished',
            updatedAt: '2026-07-14T12:00:00.000Z',
        })]);
        fs.writeFileSync(outside, 'secret');
        fs.symlinkSync(outside, path.join(fixture.logs, `${FINISHED_ID}.log`));
        assert.throws(() => formatWorkspaceTaskSummary(fixture.workspace), /storage is unsafe/);
    } finally {
        fs.rmSync(fixture.workspace, { recursive: true, force: true });
    }
});

test('task log tails remain bounded even when the final line is large', () => {
    const fixture = makeWorkspace('bounded');
    try {
        writeJournal(fixture.history, []);
        fs.writeFileSync(path.join(fixture.logs, `${FINISHED_ID}.log`), 'x'.repeat(10_000));
        const tail = __testables.readTaskLogTail(fixture.workspace, FINISHED_ID);
        assert.equal(tail.truncated, true);
        assert.ok(Buffer.byteLength(tail.text, 'utf8') <= __testables.LOG_TAIL_BYTES);
    } finally {
        fs.rmSync(fixture.workspace, { recursive: true, force: true });
    }
});

test('AchillesCLI persists task metadata and logs under .data/achilles-cli', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-owned-tasks-'));
    try {
        const update = ingestTaskEvent(workspace, {
            task: {
                id: ONGOING_ID,
                targetAgent: 'codexAgent',
                remoteTaskId: 'remote-queued',
                toolName: 'execute-task',
                description: 'Implement task ownership',
                status: 'ongoing',
                remoteStatus: 'queued',
                createdAt: '2026-07-23T10:00:00.000Z',
                updatedAt: '2026-07-23T10:00:00.000Z',
            },
            log: { tail: '[runner stdout] queued\n', seq: 1 },
        });
        assert.equal(update.task.remoteStatus, 'queued');
        assert.equal(getTask(workspace, ONGOING_ID).status, 'ongoing');
        assert.equal(readTaskLog(workspace, ONGOING_ID).text, '[runner stdout] queued\n');
        assert.equal(fs.existsSync(path.join(workspace, '.copilot_history')), false);
        assert.equal(fs.existsSync(path.join(workspace, '.data', 'achilles-cli', 'tasks', 'agent_tasks')), true);
        assert.equal(fs.existsSync(path.join(workspace, '.achilles-cli')), false);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('continuation keeps the local id, advances the turn, and filters action completions', () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'achilles-task-continue-'));
    try {
        ingestTaskEvent(workspace, {
            task: {
                id: FINISHED_ID,
                targetAgent: 'codexAgent',
                remoteTaskId: 'remote-1',
                toolName: 'execute-task',
                description: 'Continue me',
                status: 'finished',
                remoteStatus: 'completed',
                createdAt: '2026-07-23T10:00:00.000Z',
                updatedAt: '2026-07-23T10:01:00.000Z',
                continuation: {
                    version: 1,
                    targetAgent: 'codexAgent',
                    toolName: 'continue-task',
                    handle: 'abcdefghijklmnop',
                },
            },
        });
        assert.deepEqual(buildTaskCompletions(workspace, 'continue').map((item) => item.value), [FINISHED_ID]);
        assert.deepEqual(buildTaskCompletions(workspace, 'stop'), []);
        const next = beginTaskContinuation(workspace, FINISHED_ID, {
            remoteTaskId: 'remote-2',
            message: 'finish the tests',
        });
        assert.equal(next.id, FINISHED_ID);
        assert.equal(next.turn, 2);
        assert.equal(next.status, 'ongoing');
        assert.equal(next.remoteStatus, 'pending');
        assert.match(readTaskLog(workspace, FINISHED_ID).text, /you> finish the tests/);
        assert.deepEqual(buildTaskCompletions(workspace, 'stop').map((item) => item.value), [FINISHED_ID]);
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
});

test('slash handler delegates /tasks to the injected workspace reader', async () => {
    const calls = [];
    const handler = new SlashCommandHandler({
        executeSkill: async () => '',
        getUserSkills: () => [],
        getSkills: () => [],
        getTaskSummary: async (args, options) => {
            calls.push({ args, options });
            return 'task summary';
        },
    });
    const result = await handler.executeSlashCommand('tasks', '25', { context: { workingDir: '/work' } });
    assert.deepEqual(result, { handled: true, result: 'task summary' });
    assert.equal(calls[0].args, '25');
    assert.equal(calls[0].options.context.workingDir, '/work');
});

test('/exec releases the command queue when its asynchronous task starts', async () => {
    let resolveTaskStart;
    let cancelCount = 0;
    const neverFinishes = new Promise(() => {});
    const taskManager = {
        createTaskStartWaiter() {
            return {
                promise: new Promise((resolve) => { resolveTaskStart = resolve; }),
                cancel: () => { cancelCount += 1; },
            };
        },
    };
    const handler = new SlashCommandHandler({
        executeSkill: () => neverFinishes,
        getUserSkills: () => [],
        getSkills: () => [],
    });

    const command = handler.executeSlashCommand('exec', 'launch-opencode hi', {
        context: { backgroundTaskManager: taskManager },
    });
    await Promise.resolve();
    resolveTaskStart({ id: 'task_1234567890abcdef12345678' });

    assert.deepEqual(await command, { handled: true, result: 'Task started.' });
    assert.equal(cancelCount, 1);
});

test('/exec appends a launcher result that arrives after task start', async () => {
    let resolveTaskStart;
    let resolveExecution;
    const appended = [];
    const taskManager = {
        createTaskStartWaiter() {
            return {
                promise: new Promise((resolve) => { resolveTaskStart = resolve; }),
                cancel() {},
            };
        },
        appendTaskLog(...args) { appended.push(args); },
    };
    const handler = new SlashCommandHandler({
        executeSkill: () => new Promise((resolve) => { resolveExecution = resolve; }),
        getUserSkills: () => [],
        getSkills: () => [],
    });

    const command = handler.executeSlashCommand('exec', 'launch-robot desktop Analyst: inspect', {
        context: { backgroundTaskManager: taskManager },
    });
    await Promise.resolve();
    resolveTaskStart({ id: 'task_1234567890abcdef12345678' });
    assert.deepEqual(await command, { handled: true, result: 'Task started.' });
    resolveExecution('Robot started. [Open live desktop](/robot/session/)');
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(appended, [[
        'task_1234567890abcdef12345678',
        'Robot started. [Open live desktop](/robot/session/)',
        'launcher',
    ]]);
});

test('/exec still waits for ordinary synchronous skill results', async () => {
    let cancelCount = 0;
    const handler = new SlashCommandHandler({
        executeSkill: async () => 'normal result',
        getUserSkills: () => [],
        getSkills: () => [],
    });
    const result = await handler.executeSlashCommand('exec', 'list-skills', {
        context: {
            backgroundTaskManager: {
                createTaskStartWaiter: () => ({
                    promise: new Promise(() => {}),
                    cancel: () => { cancelCount += 1; },
                }),
            },
        },
    });

    assert.deepEqual(result, { handled: true, result: 'normal result' });
    assert.equal(cancelCount, 1);
});

test('slash handler delegates task view, stop, continuation, model, and login actions', async () => {
    const calls = [];
    const taskId = 'task_1234567890abcdef12345678';
    const handler = new SlashCommandHandler({
        executeSkill: async () => '',
        getUserSkills: () => [],
        getSkills: () => [],
        viewTask: async (id) => { calls.push(['view', id]); return 'task detail'; },
        stopTask: async (id) => { calls.push(['stop', id]); return { id }; },
        continueTask: async (id, prompt) => { calls.push(['continue', id, prompt]); return { id }; },
        modelTask: async (id, model) => { calls.push(['model', id, model]); return { id, model: { label: 'GPT Test' } }; },
        loginTask: async (id, provider, method) => { calls.push(['login', id, provider, method]); return { id, provider }; },
    });

    assert.deepEqual(
        await handler.executeSlashCommand('task', `view ${taskId}`),
        { handled: true, result: 'task detail' },
    );
    assert.deepEqual(
        await handler.executeSlashCommand('task', `stop ${taskId}`),
        { handled: true, result: `Stop requested for ${taskId}.` },
    );
    assert.deepEqual(
        await handler.executeSlashCommand('task', `continue ${taskId} finish the tests`),
        { handled: true, result: `Continued ${taskId}.` },
    );
    assert.deepEqual(
        await handler.executeSlashCommand('task', `model ${taskId} openai/gpt-test`),
        { handled: true, result: 'Task model set to GPT Test.' },
    );
    assert.deepEqual(
        await handler.executeSlashCommand('task', `login ${taskId} openai api_key`),
        { handled: true, result: 'Provider connected: openai.' },
    );
    assert.deepEqual(calls, [
        ['view', taskId],
        ['stop', taskId],
        ['continue', taskId, 'finish the tests'],
        ['model', taskId, 'openai/gpt-test'],
        ['login', taskId, 'openai', 'api_key'],
    ]);
});

test('terminal and WebChat bootstraps use the AchillesCLI task manager', () => {
    const replSource = fs.readFileSync(new URL('../src/repl/REPLSession.mjs', import.meta.url), 'utf8');
    const webchatSource = fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8');
    assert.match(replSource, /getTaskSummary:\s*\(args\) => formatWorkspaceTaskSummary\(this\.workingDir, args\)/);
    assert.match(webchatSource, /backgroundTaskManager\.listTasks\(\)/);
    assert.match(webchatSource, /return formatWorkspaceTaskSummary\(workingDir, args\)/);
    assert.match(webchatSource, /backgroundTaskManager\.viewTask\(taskId\)/);
    assert.match(webchatSource, /return formatWorkspaceTaskDetail\(workingDir, taskId\)/);
    assert.match(
        webchatSource,
        /import\s*\{[^}]*formatWorkspaceTaskDetail[^}]*\}\s*from '\.\/lib\/workspaceTasks\.mjs';/s,
    );
});

test('help surfaces document /tasks arguments and bounded terminal logs', () => {
    assert.match(getQuickReference(), /\/tasks.*\[count\|all\]/);
    const help = showHelp('tasks');
    assert.match(help, /Show the 10 most recently updated tasks/);
    assert.match(help, /final five log lines/);
    assert.match(help, /2 KiB per task/);
    assert.match(getQuickReference(), /\/task.*<action> <id>/);
    assert.match(showHelp('task'), /\/task continue <task-id> <prompt>/);
    assert.match(showHelp('task'), /latest five stored log lines/);
});
