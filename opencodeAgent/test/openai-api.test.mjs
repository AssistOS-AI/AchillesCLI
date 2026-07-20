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
const continueTaskPath = new URL('../scripts/continue-task.mjs', import.meta.url).pathname;

function runTaskScript(scriptPath, input, env) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [scriptPath], {
            env: { ...process.env, ...env },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, stdout, stderr }));
        child.stdin.end(JSON.stringify({ input }));
    });
}

async function makeFakeOpenCodeBin(dir) {
    const binPath = path.join(dir, 'fake-opencode.mjs');
    await fs.writeFile(binPath, `#!/usr/bin/env node
import fs from 'node:fs';

if (process.argv[2] === 'session') {
    const title = fs.readFileSync(process.env.OPENCODE_TITLE_PATH, 'utf8');
    process.stdout.write(JSON.stringify([{
        id: 'ses_test_resume',
        title,
        directory: process.env.OPENCODE_PROJECT_DIR
    }]));
    process.exit(0);
}
fs.writeFileSync(process.env.OPENCODE_ARGS_PATH, JSON.stringify(process.argv.slice(2)));
const titleIndex = process.argv.indexOf('--title');
if (titleIndex > 0) {
    fs.writeFileSync(process.env.OPENCODE_TITLE_PATH, process.argv[titleIndex + 1]);
}
process.stdout.write('fake opencode ');
await new Promise((resolve) => setTimeout(resolve, 25));
process.stdout.write('output');
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
    const titlePath = path.join(tmpDir, 'title.txt');
    const continuationStore = path.join(tmpDir, 'continuations');
    await fs.mkdir(projectDir);
    const fakeBin = await makeFakeOpenCodeBin(tmpDir);

    const result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [executeTaskPath], {
            env: {
                ...process.env,
                OPENCODE_BIN: fakeBin,
                OPENCODE_ARGS_PATH: argsPath,
                OPENCODE_TITLE_PATH: titlePath,
                OPENCODE_PROJECT_DIR: projectDir,
                PLOINKY_CONTINUATION_STORE_DIR: continuationStore,
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
    assert.equal(payload.outputText, 'fake opencode output');
    assert.equal(payload.continuation.toolName, 'continue-task');
    assert.match(payload.continuation.handle, /^[0-9a-f-]{36}$/i);
    assert.equal(result.stderr, 'fake opencode output');
    assert.doesNotMatch(result.stderr, /\[opencode|start projectDir|exit code/);

    const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
    assert.equal(args[args.indexOf('--dir') + 1], projectDir);
    assert.equal(args[args.indexOf('--model') + 1], 'xai/grok-4.3');
    assert.match(args[args.indexOf('--title') + 1], /^ploinky-task-/);
    assert.equal(args.includes('--format'), false);
    const record = JSON.parse(await fs.readFile(
        path.join(continuationStore, `${payload.continuation.handle}.json`),
        'utf8'
    ));
    assert.equal(record.sessionId, 'ses_test_resume');
    assert.equal(record.projectDir, projectDir);
});

test('continue-task resumes the exact OpenCode session behind the opaque handle', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-resume-test-'));
    const projectDir = path.join(tmpDir, 'project');
    const argsPath = path.join(tmpDir, 'args.json');
    const titlePath = path.join(tmpDir, 'title.txt');
    const continuationStore = path.join(tmpDir, 'continuations');
    await fs.mkdir(projectDir);
    const fakeBin = await makeFakeOpenCodeBin(tmpDir);
    const env = {
        OPENCODE_BIN: fakeBin,
        OPENCODE_ARGS_PATH: argsPath,
        OPENCODE_TITLE_PATH: titlePath,
        OPENCODE_PROJECT_DIR: projectDir,
        PLOINKY_CONTINUATION_STORE_DIR: continuationStore,
    };

    const initial = await runTaskScript(executeTaskPath, {
        prompt: 'Initial task',
        projectDir,
    }, env);
    assert.equal(initial.code, 0, initial.stderr);
    const firstPayload = JSON.parse(initial.stdout);

    const resumed = await runTaskScript(continueTaskPath, {
        handle: firstPayload.continuation.handle,
        prompt: 'Continue the same task',
    }, env);
    assert.equal(resumed.code, 0, resumed.stderr);
    const resumedPayload = JSON.parse(resumed.stdout);
    assert.equal(resumedPayload.continuation.handle, firstPayload.continuation.handle);
    const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
    const sessionIndex = args.indexOf('--session');
    assert.ok(sessionIndex > 0);
    assert.equal(args[sessionIndex + 1], 'ses_test_resume');
    assert.equal(args.at(-1), 'Continue the same task');
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
