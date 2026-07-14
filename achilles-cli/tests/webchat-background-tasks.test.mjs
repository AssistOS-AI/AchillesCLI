import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __testables } from '../src/lib/webchatBackgroundTasks.mjs';

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
    const history = path.join(workspace, '.copilot_history');
    fs.mkdirSync(history);
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
