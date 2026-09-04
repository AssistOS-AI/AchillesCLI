import assert from 'node:assert/strict';
import test from 'node:test';

import { action, launchRobotInternals } from '../src/skills/launch-robot/src/index.mjs';

test('starts a desktop robot in the active workspace and returns its ready Selkies link', async () => {
    const calls = [];
    const result = await action({
        promptText: 'desktop Analyst: inspect the application',
        mainAgent: { startDir: '/workspace/project' },
        pollIntervalMs: 1,
        agentClient: {
            callToolWithoutWait: async (toolName, input, options) => {
                calls.push({ toolName, input, options });
                if (toolName === 'startDesktopTaskForRobot') {
                    return { metadata: { taskId: 'task-1', status: 'running', backgroundTask: { detached: true } } };
                }
                return { ok: true, sessionUrl: '/robo/live/' };
            },
            getTaskStatus: async () => ({ id: 'task-1', status: 'running' }),
        },
    });

    assert.equal(result, 'Robot task task-1 started. [Open live desktop](/robo/live/)');
    assert.deepEqual(calls, [
        {
            toolName: 'startDesktopTaskForRobot',
            input: {
                robotName: 'Analyst',
                cwd: '/workspace/project',
                task: 'inspect the application',
                ca: 'codex',
            },
            options: undefined,
        },
        {
            toolName: 'getSessionUrlForRobotDesktop',
            input: { robotName: 'Analyst' },
            options: undefined,
        },
    ]);
});

test('starts a browser robot from JSON with optional execution hints', async () => {
    const calls = [];
    const result = await action({
        promptText: JSON.stringify({
            mode: 'browser', robotName: 'Publisher', task: 'publish the draft',
            ca: 'pi', model: 'fast', skillSets: 'editorial',
        }),
        mainAgent: { startDir: '/workspace/site' },
        pollIntervalMs: 1,
        agentClient: {
            callToolWithoutWait: async (toolName, input) => {
                calls.push({ toolName, input });
                if (toolName === 'startBrowserTaskForRobot') {
                    return { metadata: { taskId: 'task-2', status: 'running' } };
                }
                return { ok: true, sessionUrl: '/browser/live/' };
            },
            getTaskStatus: async () => ({ id: 'task-2', status: 'running' }),
        },
    });

    assert.match(result, /\[Open live browser\]\(\/browser\/live\/\)/u);
    assert.deepEqual(calls[0], {
        toolName: 'startBrowserTaskForRobot',
        input: {
            robotName: 'Publisher', cwd: '/workspace/site', task: 'publish the draft',
            ca: 'pi', model: 'fast', skillSets: 'editorial',
        },
    });
});

test('rejects non-visible robot modes before making an MCP call', async () => {
    let called = false;
    const result = await action({
        promptText: '{"mode":"simple","robotName":"Analyst","task":"work"}',
        agentClient: { callToolWithoutWait: async () => { called = true; } },
    });
    assert.match(result, /mode must be desktop or browser/u);
    assert.equal(called, false);
});

test('normalizes the compact launch syntax deterministically', () => {
    assert.deepEqual(
        launchRobotInternals.normalizeRequest('browser Research Robot: compare the two pages'),
        {
            mode: 'browser', robotName: 'Research Robot', task: 'compare the two pages', ca: 'codex',
        },
    );
});

test('reports an async RoboTeam failure while waiting for the live session', async () => {
    const result = await action({
        promptText: 'desktop Analyst: inspect the application',
        mainAgent: { startDir: '/workspace/project' },
        pollIntervalMs: 1,
        agentClient: {
            callToolWithoutWait: async () => ({ metadata: { taskId: 'task-failed', status: 'running' } }),
            getTaskStatus: async () => ({ id: 'task-failed', status: 'failed', error: 'ALA login is required' }),
        },
    });

    assert.equal(result, 'Could not start the RoboTeam task: ALA login is required');
});
