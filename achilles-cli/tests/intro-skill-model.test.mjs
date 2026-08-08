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

test('intro skill bounds the local-model prompt and visible skill catalog', async () => {
    let receivedPrompt = null;
    const skills = Array.from({ length: 30 }, (_, index) => ({
        name: `skill-${index}`,
        type: 'cskill',
        description: `Capability ${index} ${'x'.repeat(500)}`,
    }));

    await action({
        promptText: JSON.stringify({
            workingDir: '/workspace/project',
            workspaceName: 'project',
            skills,
        }),
        llmAgent: {
            async executePrompt(prompt) {
                receivedPrompt = prompt;
                return 'Welcome';
            },
        },
    });

    assert.ok(receivedPrompt.length < 2200, `intro prompt should stay bounded, got ${receivedPrompt.length}`);
    assert.match(receivedPrompt, /skill-0/);
    assert.match(receivedPrompt, /skill-11/);
    assert.doesNotMatch(receivedPrompt, /skill-12/);
    assert.doesNotMatch(receivedPrompt, /x{101}/);
});
