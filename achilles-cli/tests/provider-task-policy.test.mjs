import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDir, '..', '..');

for (const agent of ['opencodeAgent', 'piAgent', 'codexAgent']) {
    test(`${agent} keeps initial and continuation task tools internal`, () => {
        const configPath = path.join(repositoryRoot, agent, 'mcp-config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const tools = new Map(config.tools.map((tool) => [tool.name, tool]));

        assert.deepEqual(tools.get('execute-task')?.tags, ['internal']);
        assert.equal(tools.get('execute-task')?.continuationTool, 'continue-task');
        assert.deepEqual(tools.get('continue-task')?.tags, ['internal']);
        assert.equal(tools.get('continue-task')?.async, true);
    });
}
