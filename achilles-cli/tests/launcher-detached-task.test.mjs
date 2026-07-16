import test from 'node:test';
import assert from 'node:assert/strict';

import { action as launchOpenCode } from '../src/skills/launch-opencode/src/index.mjs';
import { action as launchPi } from '../src/skills/launch-pi/src/index.mjs';
import { action as launchResearch } from '../src/skills/launch-gpt-researcher/src/index.mjs';
import { __testables as runtimeTestables } from '../src/lib/ploinkyAgentRuntime.mjs';

function detachedClient(description) {
    return {
        callToolWithoutWait: async () => ({
            metadata: {
                taskId: 'remote-1',
                backgroundTask: { detached: true, id: 'task_123', description },
            },
        }),
    };
}

test('agent launchers report detached WebChat work as started', async () => {
    assert.equal(await launchOpenCode({ promptText: 'build artifacts', agentClient: detachedClient('build artifacts') }), 'Task started.');
    assert.equal(await launchPi({ promptText: 'run tests', agentClient: detachedClient('run tests') }), 'Task started.');
    assert.equal(await launchResearch({ promptText: 'research topic', agentClient: detachedClient('research topic') }), 'Task started.');
});

test('agent launchers report unclaimed asynchronous work as started', async () => {
    const agentClient = {
        callToolWithoutWait: async () => ({
            metadata: { taskId: 'remote-1', status: 'queued' },
        }),
    };

    assert.equal(await launchOpenCode({ promptText: 'build artifacts', agentClient }), 'Task started.');
    assert.equal(await launchPi({ promptText: 'run tests', agentClient }), 'Task started.');
    assert.equal(await launchResearch({ promptText: 'research topic', agentClient }), 'Task started.');
});

test('startup retry classification accepts only router agent-starting errors', () => {
    assert.equal(runtimeTestables.isAgentStillStarting(
        new Error("Agent 'opencodeAgent' is still starting. Try again in a moment.")
    ), true);
    assert.equal(runtimeTestables.isAgentStillStarting(
        new Error('The provider asked us to try again in a moment.')
    ), false);
});
