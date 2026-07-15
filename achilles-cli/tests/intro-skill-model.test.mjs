import test from 'node:test';
import assert from 'node:assert/strict';

import { action } from '../src/skills/intro-skill/src/index.mjs';

test('intro skill uses the workspace-selected model', async () => {
    let receivedOptions = null;
    const result = await action({
        promptText: JSON.stringify({ workingDir: '/workspace', workspaceName: 'workspace', skills: [] }),
        model: 'anthropic/claude-sonnet',
        llmAgent: {
            async executePrompt(_prompt, options) {
                receivedOptions = options;
                return 'Welcome';
            },
        },
    });

    assert.equal(result, 'Welcome');
    assert.deepEqual(receivedOptions, { model: 'anthropic/claude-sonnet' });
});
