import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDir, '..', '..');
const taskRunnerByAgent = {
    opencodeAgent: 'scripts/opencode-runner.mjs',
    piAgent: 'scripts/execute-task.mjs',
    codexAgent: 'scripts/codex-runner.mjs',
};
const providerExecutionByAgent = {
    opencodeAgent: {
        provider: 'opencode',
        module: '/code/scripts/execute-task.mjs',
        export: 'executeProviderTask',
    },
    piAgent: {
        provider: 'pi',
        module: '/code/scripts/execute-task.mjs',
        export: 'executeProviderTask',
    },
};

for (const agent of ['opencodeAgent', 'piAgent', 'codexAgent']) {
    test(`${agent} keeps task tools internal and without elapsed-time limits`, () => {
        const configPath = path.join(repositoryRoot, agent, 'mcp-config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const tools = new Map(config.tools.map((tool) => [tool.name, tool]));
        const runnerSource = fs.readFileSync(
            path.join(repositoryRoot, agent, taskRunnerByAgent[agent]),
            'utf8',
        );
        const controlSource = fs.readFileSync(
            path.join(repositoryRoot, agent, 'scripts/task-session-control.mjs'),
            'utf8',
        );
        const loginStore = path.join(repositoryRoot, agent, 'scripts/login-flow-store.mjs');

        assert.deepEqual(tools.get('execute-task')?.tags, ['internal']);
        if (providerExecutionByAgent[agent]) {
            assert.deepEqual(
                tools.get('execute-task')?.providerExecution,
                providerExecutionByAgent[agent],
            );
            for (const field of ['command', 'args', 'cwd', 'env']) {
                assert.equal(Object.hasOwn(tools.get('execute-task'), field), false, field);
            }
        } else {
            assert.equal(tools.get('execute-task')?.command, 'node');
        }
        assert.equal(tools.get('execute-task')?.continuationTool, 'continue-task');
        assert.equal(Object.hasOwn(tools.get('execute-task'), 'timeoutMs'), false);
        assert.deepEqual(tools.get('continue-task')?.tags, ['internal']);
        assert.equal(tools.get('continue-task')?.command, 'node');
        assert.equal(tools.get('continue-task')?.async, true);
        assert.equal(Object.hasOwn(tools.get('continue-task'), 'timeoutMs'), false);
        assert.deepEqual(tools.get('task-session-control')?.tags, ['internal']);
        assert.equal(tools.get('task-session-control')?.command, 'node');
        assert.notEqual(tools.get('task-session-control')?.async, true);
        assert.equal(Object.hasOwn(tools.get('task-session-control'), 'timeoutMs'), false);
        assert.doesNotMatch(runnerSource, /setTimeout\s*\(/);
        assert.doesNotMatch(runnerSource, /task timed out/i);
        assert.equal(fs.existsSync(loginStore), true);
        assert.match(controlSource, /from '\.\/login-flow-store\.mjs'/);
        assert.doesNotMatch(controlSource, /\/Agent\/lib\/loginFlowStore/);
    });
}

test('opencodeAgent endpoint commands resolve Node through the runtime PATH', () => {
    const manifest = JSON.parse(fs.readFileSync(
        path.join(repositoryRoot, 'opencodeAgent', 'manifest.json'),
        'utf8',
    ));

    assert.equal(manifest.endpoints?.chatCompletions?.command, 'node');
    assert.equal(manifest.endpoints?.models?.command, 'node');
});
