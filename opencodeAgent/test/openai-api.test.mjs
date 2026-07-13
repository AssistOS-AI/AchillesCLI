import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

import { handleChatCompletions, messagesToPrompt } from '../openai-api/chat-completions.mjs';
import {
    opencodeModelDescriptor,
    parseSimpleModelIds,
    parseVerboseModels,
} from '../openai-api/models.mjs';

const silentLogStream = { write() {} };
const executeTaskPath = new URL('../scripts/execute-task.mjs', import.meta.url).pathname;

async function makeFakeOpenCodeBin(dir) {
    const binPath = path.join(dir, 'fake-opencode.mjs');
    await fs.writeFile(binPath, `#!/usr/bin/env node
import fs from 'node:fs';

fs.writeFileSync(process.env.OPENCODE_ARGS_PATH, JSON.stringify(process.argv.slice(2)));
process.stdout.write('fake opencode output');
`, 'utf8');
    await fs.chmod(binPath, 0o755);
    return binPath;
}

test('messagesToPrompt preserves text roles', () => {
    assert.equal(messagesToPrompt([
        { role: 'system', content: 'Follow repo rules.' },
        { role: 'user', content: [{ type: 'text', text: 'Implement the change.' }] },
    ]), 'System:\nFollow repo rules.\n\nUser:\nImplement the change.');
});

test('chat completions runs OpenCode in WORKSPACE_PATH with requested model', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-test-'));
    const workspaceDir = path.join(tmpDir, 'workspace');
    const wrongWorkspaceRoot = path.join(tmpDir, 'wrong-root');
    const argsPath = path.join(tmpDir, 'args.json');
    await fs.mkdir(workspaceDir);
    await fs.mkdir(wrongWorkspaceRoot);
    const fakeBin = await makeFakeOpenCodeBin(tmpDir);

    const completion = await handleChatCompletions({
        request: {
            model: 'opencode/gpt-5',
            messages: [
                { role: 'user', content: 'Build this.' },
            ],
        },
    }, {
        env: {
            ...process.env,
            OPENCODE_BIN: fakeBin,
            OPENCODE_ARGS_PATH: argsPath,
            WORKSPACE_PATH: workspaceDir,
            PLOINKY_WORKSPACE_ROOT: wrongWorkspaceRoot,
        },
        logStream: silentLogStream,
    });

    assert.equal(completion.object, 'chat.completion');
    assert.equal(completion.model, 'opencode/gpt-5');
    assert.equal(completion.choices[0].message.content, 'fake opencode output');

    const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
    assert.deepEqual(args.slice(0, 5), [
        'run',
        '--dangerously-skip-permissions',
        '--dir',
        workspaceDir,
        '--model',
    ]);
    assert.equal(args[5], 'opencode/gpt-5');
    assert.notEqual(args[3], wrongWorkspaceRoot);
});

test('execute-task MCP wrapper preserves prompt projectDir model input', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-mcp-test-'));
    const projectDir = path.join(tmpDir, 'project');
    const argsPath = path.join(tmpDir, 'args.json');
    await fs.mkdir(projectDir);
    const fakeBin = await makeFakeOpenCodeBin(tmpDir);

    const result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [executeTaskPath], {
            env: {
                ...process.env,
                OPENCODE_BIN: fakeBin,
                OPENCODE_ARGS_PATH: argsPath,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', reject);
        child.on('close', (code) => {
            resolve({ code, stdout, stderr });
        });
        child.stdin.end(JSON.stringify({
            input: {
                prompt: 'Run MCP task.',
                projectDir,
                model: 'xai/grok-4.3',
            },
        }));
    });

    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.projectDir, projectDir);
    assert.equal(payload.effectiveProjectDir, projectDir);
    assert.equal(payload.model, 'xai/grok-4.3');

    const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
    assert.equal(args[3], projectDir);
    assert.equal(args[5], 'xai/grok-4.3');
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
    assert.deepEqual(free.tags, ['coding', 'agentic']);

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
