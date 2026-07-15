import test from 'node:test';
import assert from 'node:assert/strict';

import { action as launchOpenCode } from '../src/skills/launch-opencode/src/index.mjs';
import { action as launchPi } from '../src/skills/launch-pi/src/index.mjs';
import { action as launchResearch } from '../src/skills/launch-gpt-researcher/src/index.mjs';

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
    assert.equal(await launchOpenCode({ promptText: 'build artifacts', agentClient: detachedClient('build artifacts') }), 'opencodeAgent started the task.');
    assert.equal(await launchPi({ promptText: 'run tests', agentClient: detachedClient('run tests') }), 'piAgent started the task.');
    assert.equal(await launchResearch({ promptText: 'research topic', agentClient: detachedClient('research topic') }), 'GPTResearcher started the task.');
});

test('agent launchers report unclaimed asynchronous work as started', async () => {
    const agentClient = {
        callToolWithoutWait: async () => ({
            metadata: { taskId: 'remote-1', status: 'queued' },
        }),
    };

    assert.equal(await launchOpenCode({ promptText: 'build artifacts', agentClient }), 'opencodeAgent started the task.');
    assert.equal(await launchPi({ promptText: 'run tests', agentClient }), 'piAgent started the task.');
    assert.equal(await launchResearch({ promptText: 'research topic', agentClient }), 'GPTResearcher started the task.');
});
