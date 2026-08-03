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
import {
    __testables as openCodeRunnerTestables,
    findSessionIdFromDatabase,
    readRecentOpenCodeModel,
} from '../scripts/opencode-runner.mjs';

const silentLogStream = { write() {} };
const executeTaskPath = new URL('../scripts/execute-task.mjs', import.meta.url).pathname;
const continueTaskPath = new URL('../scripts/continue-task.mjs', import.meta.url).pathname;
const fakeBwrapPath = new URL('../../tests/helpers/fake-bwrap.sh', import.meta.url).pathname;
const taskHarnessPath = new URL('../../tests/helpers/run-agent-task.mjs', import.meta.url).pathname;

function sandboxDependencies() {
    return {
        bwrapPath: fakeBwrapPath,
        procInspector: () => ({
            ok: true,
            processPid: process.pid,
            procSelfPid: process.pid,
            pidNamespaceVisible: true,
            namespaceDevice: 'test-device',
            namespaceInode: 'test-inode',
            error: null,
        }),
        taskEnvironmentNames: [
            'FAKE_OPENCODE_FAIL',
            'FAKE_OPENCODE_WAIT_MS',
            'OPENCODE_ARGS_PATH',
            'OPENCODE_PROJECT_DIR',
            'OPENCODE_TITLE_PATH',
        ],
    };
}

function runTaskScript(scriptPath, input, env, { signalAfterMs = 0, signalAfterPath = '' } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [taskHarnessPath, scriptPath], {
            env: {
                ...process.env,
                TEST_TASK_BWRAP_BIN: fakeBwrapPath,
                ...env,
            },
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let closed = false;
        child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
        child.on('error', reject);
        child.on('close', (code) => {
            closed = true;
            resolve({ code, stdout, stderr });
        });
        child.stdin.end(JSON.stringify({ input }));
        if (signalAfterMs > 0) {
            setTimeout(() => child.kill('SIGTERM'), signalAfterMs);
        }
        if (signalAfterPath) {
            void (async () => {
                while (!closed) {
                    try {
                        await fs.access(signalAfterPath);
                        child.kill('SIGTERM');
                        return;
                    } catch {
                        await new Promise((wait) => setTimeout(wait, 10));
                    }
                }
            })();
        }
    });
}

async function makeFakeOpenCodeBin(dir) {
    const binPath = path.join(dir, 'fake-opencode.mjs');
    await fs.writeFile(binPath, `#!${process.execPath}
import fs from 'node:fs';

const writeStdout = (text) => fs.writeSync(1, text);

if (process.argv[2] === 'session') {
    const title = fs.readFileSync(process.env.OPENCODE_TITLE_PATH, 'utf8');
    writeStdout(JSON.stringify([{
        id: 'ses_test_resume',
        title,
        directory: process.cwd()
    }]));
    process.exit(0);
}
if (process.argv[2] === 'export') {
    writeStdout('Exporting session\\n' + JSON.stringify({
        messages: [{
            info: { role: 'assistant' },
            parts: [{ type: 'text', text: 'fake opencode output' }]
        }]
    }));
    process.exit(0);
}
fs.writeFileSync(process.env.OPENCODE_ARGS_PATH, JSON.stringify(process.argv.slice(2)));
const titleIndex = process.argv.indexOf('--title');
if (titleIndex > 0) {
    fs.writeFileSync(process.env.OPENCODE_TITLE_PATH, process.argv[titleIndex + 1]);
}
if (titleIndex > 0 || process.argv.includes('--session')) {
    writeStdout('reading repository\\n');
}
writeStdout('fake opencode ');
await new Promise((resolve) => setTimeout(
    resolve,
    Number(process.env.FAKE_OPENCODE_WAIT_MS || 25),
));
writeStdout('output');
if (process.env.FAKE_OPENCODE_FAIL === '1') {
    process.stderr.write('insufficient credits');
    process.exitCode = 1;
}
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

test('recent OpenCode model lookup falls back when state is unavailable', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-state-test-'));
    assert.deepEqual(
        await readRecentOpenCodeModel({ XDG_STATE_HOME: tmpDir }),
        { model: '', variant: '' },
    );
});

test('OpenCode session recovery reads the persisted database without launching the CLI', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-session-db-test-'));
    const projectDir = path.join(tmpDir, 'project');
    const dataRoot = path.join(tmpDir, 'data');
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

test('OpenCode capability failure returns the stable code before project or session mutation', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-capability-failure-test-'));
    const workspaceDir = path.join(tmpDir, 'workspace');
    const projectDir = path.join(workspaceDir, 'missing-project');
    const continuationStore = path.join(tmpDir, 'continuations');
    await fs.mkdir(workspaceDir);
    const result = await runTaskScript(executeTaskPath, {
        prompt: 'must not run',
        projectDir,
    }, {
        OPENCODE_BIN: path.join(tmpDir, 'missing-opencode'),
        PLOINKY_CONTINUATION_STORE_DIR: continuationStore,
        PLOINKY_WORKSPACE_ROOT: workspaceDir,
        TEST_TASK_BWRAP_MODE: 'fail',
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /^PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE:/);
    assert.deepEqual(JSON.parse(result.stdout), {
        ok: false,
        outputText: '',
        error: 'nested Bubblewrap capability is unavailable (private: test capability unavailable; empty: test capability unavailable)',
        code: 'PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE',
        status: 422,
    });
    await assert.rejects(fs.access(projectDir));
    await assert.rejects(fs.access(continuationStore));
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
            PLOINKY_WORKSPACE_ROOT: workspaceDir,
        },
        logStream: silentLogStream,
        sandboxDependencies: sandboxDependencies(),
    });

    assert.equal(completion.object, 'chat.completion');
    assert.equal(completion.model, 'opencode/gpt-5');
    assert.equal(completion.choices[0].message.content, 'fake opencode output');

    const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
    assert.deepEqual(args.slice(0, 5), [
        'run',
        '--auto',
        '--dir',
        await fs.realpath(workspaceDir),
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

    const result = await runTaskScript(executeTaskPath, {
        prompt: 'Run MCP task.',
        projectDir,
        model: 'xai/grok-4.3',
    }, {
        OPENCODE_BIN: fakeBin,
        OPENCODE_ARGS_PATH: argsPath,
        OPENCODE_TITLE_PATH: titlePath,
        OPENCODE_PROJECT_DIR: projectDir,
        PLOINKY_CONTINUATION_STORE_DIR: continuationStore,
        PLOINKY_WORKSPACE_ROOT: projectDir,
    });

    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.outputText, 'fake opencode output');
    assert.equal(payload.continuation.toolName, 'continue-task');
    assert.match(payload.continuation.handle, /^[0-9a-f-]{36}$/i);
    assert.equal(result.stderr, 'reading repository\nfake opencode output');
    assert.doesNotMatch(result.stderr, /\[opencode|start projectDir|exit code/);

    const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
    assert.equal(args[args.indexOf('--dir') + 1], await fs.realpath(projectDir));
    assert.equal(args[args.indexOf('--model') + 1], 'xai/grok-4.3');
    assert.match(args[args.indexOf('--title') + 1], /^ploinky-task-/);
    assert.equal(args.includes('--format'), false);
    const record = JSON.parse(await fs.readFile(
        path.join(continuationStore, `${payload.continuation.handle}.json`),
        'utf8'
    ));
    assert.equal(record.sessionId, 'ses_test_resume');
    assert.equal(record.projectDir, await fs.realpath(projectDir));
});

test('generated-local OpenCode tasks use the scoped Soul provider', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-soul-task-test-'));
    const projectDir = path.join(tmpDir, 'project');
    const argsPath = path.join(tmpDir, 'args.json');
    const titlePath = path.join(tmpDir, 'title.txt');
    await fs.mkdir(projectDir);
    const fakeBin = await makeFakeOpenCodeBin(tmpDir);

    const result = await runTaskScript(executeTaskPath, {
        prompt: 'Run through Soul.',
        projectDir,
        model: 'xai/grok-4.3',
    }, {
        OPENCODE_BIN: fakeBin,
        OPENCODE_ARGS_PATH: argsPath,
        OPENCODE_TITLE_PATH: titlePath,
        PLOINKY_CONTINUATION_STORE_DIR: path.join(tmpDir, 'continuations'),
        PLOINKY_WORKSPACE_ROOT: projectDir,
        PLOINKY_ROUTER_URL: 'http://127.0.0.1:9',
        PLOINKY_ROUTER_REQUEST_AUTHORITY: '127.0.0.1:9',
        PLOINKY_AGENT_API_KEY: 'outer-only-key',
        PLOINKY_ENV_SOURCE_PLOINKY_ROUTER_URL: 'generated',
        PLOINKY_ENV_SOURCE_PLOINKY_ROUTER_REQUEST_AUTHORITY: 'generated',
        PLOINKY_ENV_SOURCE_PLOINKY_AGENT_API_KEY: 'generated',
    });

    assert.equal(result.code, 0, result.stderr);
    const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
    assert.equal(args[args.indexOf('--model') + 1], 'soul/fast');
});

test('failed OpenCode task returns a continuation handle when its session was created', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-failed-task-test-'));
    const projectDir = path.join(tmpDir, 'project');
    const continuationStore = path.join(tmpDir, 'continuations');
    const titlePath = path.join(tmpDir, 'title.txt');
    await fs.mkdir(projectDir);
    const fakeBin = await makeFakeOpenCodeBin(tmpDir);

    const result = await runTaskScript(executeTaskPath, {
        prompt: 'Use exhausted model',
        projectDir,
    }, {
        OPENCODE_BIN: fakeBin,
        OPENCODE_ARGS_PATH: path.join(tmpDir, 'args.json'),
        OPENCODE_TITLE_PATH: titlePath,
        OPENCODE_PROJECT_DIR: projectDir,
        PLOINKY_CONTINUATION_STORE_DIR: continuationStore,
        PLOINKY_WORKSPACE_ROOT: projectDir,
        FAKE_OPENCODE_FAIL: '1',
    });

    assert.equal(result.code, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.continuation.toolName, 'continue-task');
    assert.match(payload.continuation.handle, /^[0-9a-f-]{36}$/i);
    const record = JSON.parse(await fs.readFile(
        path.join(continuationStore, `${payload.continuation.handle}.json`),
        'utf8',
    ));
    assert.equal(record.sessionId, 'ses_test_resume');
    assert.equal(record.projectDir, await fs.realpath(projectDir));
});

test('cancelled OpenCode task saves the session before the wrapper exits', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-cancelled-task-test-'));
    const projectDir = path.join(tmpDir, 'project');
    const continuationStore = path.join(tmpDir, 'continuations');
    const titlePath = path.join(tmpDir, 'title.txt');
    await fs.mkdir(projectDir);
    const fakeBin = await makeFakeOpenCodeBin(tmpDir);

    const result = await runTaskScript(executeTaskPath, {
        prompt: 'Stop after session creation',
        projectDir,
    }, {
        OPENCODE_BIN: fakeBin,
        OPENCODE_ARGS_PATH: path.join(tmpDir, 'args.json'),
        OPENCODE_TITLE_PATH: titlePath,
        OPENCODE_PROJECT_DIR: projectDir,
        PLOINKY_CONTINUATION_STORE_DIR: continuationStore,
        PLOINKY_WORKSPACE_ROOT: projectDir,
        FAKE_OPENCODE_WAIT_MS: '1000',
    }, { signalAfterPath: titlePath });

    assert.equal(result.code, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.continuation.toolName, 'continue-task');
    const record = JSON.parse(await fs.readFile(
        path.join(continuationStore, `${payload.continuation.handle}.json`),
        'utf8',
    ));
    assert.equal(record.sessionId, 'ses_test_resume');
});

test('continue-task resumes the exact OpenCode session behind the opaque handle', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-agent-resume-test-'));
    const projectDir = path.join(tmpDir, 'project');
    const argsPath = path.join(tmpDir, 'args.json');
    const titlePath = path.join(tmpDir, 'title.txt');
    const continuationStore = path.join(tmpDir, 'continuations');
    const stateRoot = path.join(tmpDir, 'state');
    await fs.mkdir(projectDir);
    const fakeBin = await makeFakeOpenCodeBin(tmpDir);
    const env = {
        OPENCODE_BIN: fakeBin,
        OPENCODE_ARGS_PATH: argsPath,
        OPENCODE_TITLE_PATH: titlePath,
        OPENCODE_PROJECT_DIR: projectDir,
        PLOINKY_CONTINUATION_STORE_DIR: continuationStore,
        PLOINKY_WORKSPACE_ROOT: projectDir,
        XDG_STATE_HOME: stateRoot,
    };

    const initial = await runTaskScript(executeTaskPath, {
        prompt: 'Initial task',
        projectDir,
    }, env);
    assert.equal(initial.code, 0, initial.stderr);
    const firstPayload = JSON.parse(initial.stdout);
    await fs.mkdir(path.join(stateRoot, 'opencode'), { recursive: true });
    await fs.writeFile(path.join(stateRoot, 'opencode', 'model.json'), JSON.stringify({
        recent: [{ providerID: 'openai', modelID: 'gpt-5.4-mini' }],
        variant: { 'openai/gpt-5.4-mini': 'high' },
    }));

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
    assert.equal(args[args.indexOf('--model') + 1], 'openai/gpt-5.4-mini');
    assert.equal(args[args.indexOf('--variant') + 1], 'high');
    assert.equal(args.at(-1), 'Continue the same task');

    const overridden = await runTaskScript(continueTaskPath, {
        handle: firstPayload.continuation.handle,
        prompt: 'Continue with the task model',
        model: 'anthropic/claude-sonnet-4-5',
    }, env);
    assert.equal(overridden.code, 0, overridden.stderr);
    const overrideArgs = JSON.parse(await fs.readFile(argsPath, 'utf8'));
    assert.equal(overrideArgs[overrideArgs.indexOf('--model') + 1], 'anthropic/claude-sonnet-4-5');
    assert.equal(overrideArgs.includes('--variant'), false);
    assert.equal(overrideArgs.at(-1), 'Continue with the task model');
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
