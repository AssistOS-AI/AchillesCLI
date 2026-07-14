import test from 'node:test';
import assert from 'node:assert/strict';

import { action as launchOpenCode } from '../src/skills/launch-opencode/src/index.mjs';
import { action as launchPi } from '../src/skills/launch-pi/src/index.mjs';
import { action as launchResearch } from '../src/skills/launch-gpt-researcher/src/index.mjs';

function detachedClient(description) {
    return {
        callTool: async () => ({
            metadata: {
                taskId: 'remote-1',
                backgroundTask: { detached: true, id: 'task_123', description },
            },
        }),
    };
}

test('agent launchers report detached WebChat work as started', async () => {
    assert.equal(await launchOpenCode({ promptText: 'build artifacts', agentClient: detachedClient('build artifacts') }), 'Task started: build artifacts');
    assert.equal(await launchPi({ promptText: 'run tests', agentClient: detachedClient('run tests') }), 'Task started: run tests');
    assert.equal(await launchResearch({ promptText: 'research topic', agentClient: detachedClient('research topic') }), 'Task started: research topic');
});
