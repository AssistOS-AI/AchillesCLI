import assert from 'node:assert/strict';
import test from 'node:test';

import {
    shouldStartWebchatIntro,
    startWebchatIntroSkill,
} from '../src/lib/introSkillBoot.mjs';

function makeAgent() {
    let executions = 0;
    return {
        get executions() {
            return executions;
        },
        getSkillRecord() {
            return { name: 'intro-skill-cskill' };
        },
        async executeSkill() {
            executions += 1;
            return { result: 'Workspace intro' };
        },
        logger: { debug() {} },
    };
}

test('existing WebChat history suppresses the startup intro', async () => {
    const agent = makeAgent();
    const messages = [];
    const result = await startWebchatIntroSkill(agent, {
        env: {
            PLOINKY_WEBCHAT_HAS_HISTORY: '1',
        },
        write: async (message) => messages.push(message),
    });

    assert.equal(result, null);
    assert.equal(agent.executions, 0);
    assert.deepEqual(messages, []);
});

test('empty or unspecified WebChat history keeps the startup intro', async () => {
    assert.equal(shouldStartWebchatIntro({
        PLOINKY_WEBCHAT_HAS_HISTORY: '0',
    }), true);
    assert.equal(shouldStartWebchatIntro({ PLOINKY_WEBCHAT_HAS_HISTORY: '1' }), false);
    assert.equal(shouldStartWebchatIntro({}), true);

    const agent = makeAgent();
    const messages = [];
    const result = await startWebchatIntroSkill(agent, {
        env: {
            PLOINKY_WEBCHAT_HAS_HISTORY: '0',
        },
        write: async (message) => messages.push(message),
    });

    assert.equal(result, 'Workspace intro');
    assert.equal(agent.executions, 1);
    assert.deepEqual(messages, ['Workspace intro\n']);
});
