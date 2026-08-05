import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { messagesToPrompt } from '../openai-api/chat-completions.mjs';
import {
    opencodeModelDescriptor,
    parseSimpleModelIds,
    parseVerboseModels,
} from '../openai-api/models.mjs';
import {
    __testables as openCodeRunnerTestables,
    findSessionIdFromDatabase,
    readRecentOpenCodeModel,
} from '../scripts/opencode-runner.mjs';

test('messagesToPrompt preserves text roles', () => {
    assert.equal(messagesToPrompt([
        { role: 'system', content: 'Follow repo rules.' },
        { role: 'user', content: [{ type: 'text', text: 'Implement the change.' }] },
    ]), 'System:\nFollow repo rules.\n\nUser:\nImplement the change.');
});

test('recent OpenCode model lookup fails closed without a canonical HOME fallback', async (t) => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-state-test-'));
    t.after(() => fs.rm(temporary, { recursive: true, force: true }));
    assert.deepEqual(
        await readRecentOpenCodeModel({ XDG_STATE_HOME: temporary }),
        { model: '', variant: '' },
    );
    await assert.rejects(readRecentOpenCodeModel({}), /canonical provider HOME/);
});

test('OpenCode session recovery reads the canonical runtime database without launching the CLI', async (t) => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-session-db-test-'));
    t.after(() => fs.rm(temporary, { recursive: true, force: true }));
    const projectDir = path.join(temporary, 'project');
    const dataRoot = path.join(temporary, 'data');
    const databaseDirectory = path.join(dataRoot, 'opencode');
    await fs.mkdir(projectDir);
    await fs.mkdir(databaseDirectory, { recursive: true });
    const { DatabaseSync } = await import('node:sqlite');
    const database = new DatabaseSync(path.join(databaseDirectory, 'opencode.db'));
    database.exec(`
        CREATE TABLE session (
            id TEXT PRIMARY KEY,
            directory TEXT NOT NULL,
            title TEXT NOT NULL,
            time_updated INTEGER NOT NULL
        )
    `);
    database.prepare(
        'INSERT INTO session (id, directory, title, time_updated) VALUES (?, ?, ?, ?)'
    ).run('ses_db', await fs.realpath(projectDir), 'ploinky-task-test', 1);
    database.close();

    assert.equal(await findSessionIdFromDatabase({
        projectDir,
        title: 'ploinky-task-test',
        env: { XDG_DATA_HOME: dataRoot },
    }), 'ses_db');
});

test('OpenCode retained output is byte bounded without an elapsed task timeout', () => {
    const retained = openCodeRunnerTestables.appendBoundedTail('', '€'.repeat(20_000));
    assert.ok(Buffer.byteLength(retained, 'utf8') <= openCodeRunnerTestables.LOG_TAIL_LIMIT);
    assert.match(retained, /€+$/u);
});

test('parseVerboseModels maps OpenCode metadata to Soul Gateway model descriptors', () => {
    const records = parseVerboseModels(`opencode/free-model
{
  "id": "free-model",
  "providerID": "opencode",
  "name": "Free Model",
  "family": "free",
  "status": "active",
  "cost": { "input": 0, "output": 0 },
  "limit": { "context": 200000, "output": 32000 },
  "capabilities": {
    "toolcall": true,
    "input": { "image": false, "pdf": false, "video": false }
  }
}
xai/grok-4.3
{
  "id": "grok-4.3",
  "providerID": "xai",
  "name": "Grok 4.3",
  "cost": { "input": 3, "output": 15 },
  "limit": { "context": 256000, "output": 16000 },
  "capabilities": {
    "toolcall": false,
    "input": { "image": true, "pdf": false, "video": false }
  }
}
`);

    assert.equal(records.length, 2);
    const free = opencodeModelDescriptor(records[0]);
    assert.equal(free.id, 'opencode/free-model');
    assert.equal(free.pricingMode, 'free');
    assert.equal(free.isFree, true);
    assert.equal(free.contextWindow, 200000);
    assert.equal(free.maxOutputTokens, 32000);
    assert.equal(free.supportsTools, true);
    assert.deepEqual(free.tags, ['coding-agent']);

    const paid = opencodeModelDescriptor(records[1]);
    assert.equal(paid.id, 'xai/grok-4.3');
    assert.equal(paid.pricingMode, 'token');
    assert.equal(paid.inputPricePerMillion, 3);
    assert.equal(paid.outputPricePerMillion, 15);
    assert.equal(paid.supportsVision, true);
});

test('simple model parsing falls back to external-directory pricing', () => {
    const records = parseSimpleModelIds('opencode/gpt-5\nnot a model\nxai/grok-4.3\n');
    assert.deepEqual(records.map((record) => record.fullId), ['opencode/gpt-5', 'xai/grok-4.3']);

    const descriptor = opencodeModelDescriptor(records[0]);
    assert.equal(descriptor.pricingMode, 'external_directory');
    assert.equal(descriptor.inputPricePerMillion, null);
    assert.equal(descriptor.outputPricePerMillion, null);
});
