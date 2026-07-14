import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { SlashCommandHandler } from '../src/repl/SlashCommandHandler.mjs';
import { getQuickReference, showHelp } from '../src/ui/HelpSystem.mjs';
import {
    __testables,
    formatWorkspaceTaskSummary,
    readOngoingTasks,
    readWorkspaceTasks,
} from '../src/lib/workspaceTasks.mjs';

const FINISHED_ID = 'task_111111111111111111111111';
const ONGOING_ID = 'task_222222222222222222222222';
const ERROR_ID = 'task_333333333333333333333333';

function makeWorkspace(label) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `achilles-tasks-${label}-`));
    const history = path.join(workspace, '.copilot_history');
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
        assert.equal(fs.existsSync(path.join(workspace, '.copilot_history')), false);
        const missingWorkspace = path.join(workspace, 'missing');
        assert.throws(
            () => formatWorkspaceTaskSummary(missingWorkspace),
            (error) => error.message === 'Unable to read task history (ENOENT).',
        );
        fs.symlinkSync(outside, path.join(workspace, '.copilot_history'), 'dir');
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

test('terminal and WebChat bootstraps inject the same workspace task formatter', () => {
    const replSource = fs.readFileSync(new URL('../src/repl/REPLSession.mjs', import.meta.url), 'utf8');
    const webchatSource = fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8');
    assert.match(replSource, /getTaskSummary:\s*\(args\) => formatWorkspaceTaskSummary\(this\.workingDir, args\)/);
    assert.match(webchatSource, /getTaskSummary:\s*\(args\) => formatWorkspaceTaskSummary\(workingDir, args\)/);
});

test('help surfaces document /tasks arguments and bounded terminal logs', () => {
    assert.match(getQuickReference(), /\/tasks.*\[count\|all\]/);
    const help = showHelp('tasks');
    assert.match(help, /Show the 10 most recently updated tasks/);
    assert.match(help, /final five log lines/);
    assert.match(help, /2 KiB per task/);
});
