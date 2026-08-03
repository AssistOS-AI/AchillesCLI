import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { resolveCopilotCodingAgentLauncher } from '../src/lib/copilotCodingAgentRouting.mjs';

test('Copilot routes explicit fixed coding-agent task requests before generic reasoning', () => {
    assert.equal(resolveCopilotCodingAgentLauncher('Delegate this task specifically to Codex/codexAgent.'), 'launch-codex');
    assert.equal(resolveCopilotCodingAgentLauncher('Use Open Code to refactor this module.'), 'launch-opencode');
    assert.equal(resolveCopilotCodingAgentLauncher('Have piAgent inspect this failure.'), 'launch-pi');
});

test('Copilot does not route mentions that lack task intent', () => {
    assert.equal(resolveCopilotCodingAgentLauncher('What is Codex?'), null);
    assert.equal(resolveCopilotCodingAgentLauncher('What should Codex do?'), null);
    assert.equal(resolveCopilotCodingAgentLauncher('Compare OpenCode and Codex.'), null);
    assert.equal(resolveCopilotCodingAgentLauncher('@codex hello'), null);
});

test('WebChat invokes the fixed launcher before the generic reasoning loop', async () => {
    const source = await fs.readFile(new URL('../src/index.mjs', import.meta.url), 'utf8');
    const resolverIndex = source.indexOf('resolveCopilotCodingAgentLauncher(message)');
    const launcherIndex = source.indexOf('skillName: fixedCodingAgentLauncher', resolverIndex);
    const genericIndex = source.indexOf('activeAgent.executePrompt(akuPrompt.prompt', resolverIndex);

    assert.ok(resolverIndex >= 0);
    assert.ok(launcherIndex > resolverIndex);
    assert.ok(genericIndex > launcherIndex);
});
