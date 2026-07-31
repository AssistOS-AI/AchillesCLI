import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

import { buildCodexArgs, eventLogText } from '../scripts/codex-runner.mjs';

const executeTaskPath = new URL('../scripts/execute-task.mjs', import.meta.url).pathname;
const continueTaskPath = new URL('../scripts/continue-task.mjs', import.meta.url).pathname;

function runTaskScript(scriptPath, input, env, { signalAfterMs = 0 } = {}) {
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
        if (signalAfterMs > 0) {
            setTimeout(() => child.kill('SIGTERM'), signalAfterMs);
        }
    });
}

async function makeFakeCodexBin(directory) {
    const binPath = path.join(directory, 'fake-codex.mjs');
    await fs.writeFile(binPath, `#!/usr/bin/env node
import fs from 'node:fs';

const args = process.argv.slice(2);
fs.writeFileSync(process.env.CODEX_ARGS_PATH, JSON.stringify(args));
const resumeIndex = args.indexOf('resume');
const threadId = resumeIndex >= 0 ? args.at(-2) : '018f6f4a-4ec8-7d31-a852-0242ac120002';
process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: threadId }) + '\\n');
process.stdout.write(JSON.stringify({
    type: 'item.completed',
    item: { type: 'command_execution', aggregated_output: 'command output\\n' }
}) + '\\n');
await new Promise((resolve) => setTimeout(
    resolve,
    Number(process.env.FAKE_CODEX_WAIT_MS || 10),
));
const configuredModel = process.env.FAKE_CODEX_CURRENT_MODEL || 'configured-default';
process.stdout.write(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: configuredModel + ': final answer\\n' }
}) + '\\n');
await new Promise((resolve) => setTimeout(resolve, 10));
process.stderr.write('provider stderr\\n');
if (process.env.FAKE_CODEX_FAIL === '1') process.exitCode = 1;
`, 'utf8');
    await fs.chmod(binPath, 0o755);
    return binPath;
}

test('Codex initial arguments persist a thread and allow an explicit initial model', () => {
    assert.deepEqual(buildCodexArgs({
        prompt: 'Build this.',
        model: 'gpt-initial',
    }), [
        '--sandbox',
        'workspace-write',
        '--ask-for-approval',
        'never',
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--model',
        'gpt-initial',
        'Build this.',
    ]);
});

test('Codex resume arguments apply an explicit task model', () => {
    const args = buildCodexArgs({
        prompt: 'Continue.',
        model: 'must-not-be-used',
        threadId: 'thread-1',
    });
    assert.deepEqual(args, [
        '--sandbox',
        'workspace-write',
        '--ask-for-approval',
        'never',
        'exec',
        'resume',
        '--json',
        '--skip-git-repo-check',
        '--model',
        'must-not-be-used',
        'thread-1',
        'Continue.',
    ]);
    assert.equal(args.includes('--model'), true);
});

test('eventLogText exposes provider text without synthetic decoration', () => {
    assert.equal(eventLogText({
        type: 'item.completed',
        item: { type: 'agent_message', text: 'answer\\n' },
    }), 'answer\\n');
    assert.equal(eventLogText({
        type: 'item.completed',
        item: { type: 'reasoning', text: 'private reasoning' },
    }), '');
});

test('execute-task streams Codex text and stderr raw and persists only private resume data', async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-agent-task-'));
    const projectDir = path.join(temporaryDirectory, 'project');
    const argsPath = path.join(temporaryDirectory, 'args.json');
    const continuationStore = path.join(temporaryDirectory, 'continuations');
    await fs.mkdir(projectDir);
    const fakeBin = await makeFakeCodexBin(temporaryDirectory);
    const result = await runTaskScript(executeTaskPath, {
        prompt: 'Initial task',
        projectDir,
        model: 'gpt-initial',
    }, {
        CODEX_BIN: fakeBin,
        CODEX_ARGS_PATH: argsPath,
        PLOINKY_CONTINUATION_STORE_DIR: continuationStore,
        FAKE_CODEX_CURRENT_MODEL: 'gpt-initial',
    });

    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.outputText, 'gpt-initial: final answer');
    assert.equal(payload.continuation.toolName, 'continue-task');
    assert.match(payload.continuation.handle, /^[0-9a-f-]{36}$/i);
    assert.equal(result.stderr, 'command output\ngpt-initial: final answer\nprovider stderr\n');
    assert.doesNotMatch(result.stderr, /thread\.started|item\.completed|\[codex|exit code/);

    const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
    assert.deepEqual(args.slice(0, 5), [
        '--sandbox',
        'workspace-write',
        '--ask-for-approval',
        'never',
        'exec',
    ]);
    assert.equal(args.includes('--ephemeral'), false);
    assert.equal(args.includes('--dangerously-bypass-approvals-and-sandbox'), false);
    assert.equal(args[args.indexOf('--model') + 1], 'gpt-initial');
    const record = JSON.parse(await fs.readFile(
        path.join(continuationStore, `${payload.continuation.handle}.json`),
        'utf8',
    ));
    assert.equal(record.provider, 'codex');
    assert.equal(record.threadId, '018f6f4a-4ec8-7d31-a852-0242ac120002');
    assert.equal(record.projectDir, projectDir);
    assert.equal(Object.hasOwn(record, 'model'), false);
});

test('continue-task keeps the default without an override and applies a task model when supplied', async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-agent-resume-'));
    const projectDir = path.join(temporaryDirectory, 'project');
    const argsPath = path.join(temporaryDirectory, 'args.json');
    const continuationStore = path.join(temporaryDirectory, 'continuations');
    await fs.mkdir(projectDir);
    const fakeBin = await makeFakeCodexBin(temporaryDirectory);
    const env = {
        CODEX_BIN: fakeBin,
        CODEX_ARGS_PATH: argsPath,
        PLOINKY_CONTINUATION_STORE_DIR: continuationStore,
    };
    const initial = await runTaskScript(executeTaskPath, {
        prompt: 'Initial task',
        projectDir,
        model: 'gpt-old',
    }, {
        ...env,
        FAKE_CODEX_CURRENT_MODEL: 'gpt-old',
    });
    assert.equal(initial.code, 0, initial.stderr);
    const initialPayload = JSON.parse(initial.stdout);

    const resumed = await runTaskScript(continueTaskPath, {
        handle: initialPayload.continuation.handle,
        prompt: 'Continue the task',
    }, {
        ...env,
        FAKE_CODEX_CURRENT_MODEL: 'gpt-current',
    });
    assert.equal(resumed.code, 0, resumed.stderr);
    const resumedPayload = JSON.parse(resumed.stdout);
    assert.equal(resumedPayload.outputText, 'gpt-current: final answer');
    assert.equal(resumedPayload.continuation.handle, initialPayload.continuation.handle);
    const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
    assert.deepEqual(args.slice(0, 6), [
        '--sandbox',
        'workspace-write',
        '--ask-for-approval',
        'never',
        'exec',
        'resume',
    ]);
    assert.equal(args.includes('--model'), false);
    assert.equal(args.includes('--dangerously-bypass-approvals-and-sandbox'), false);
    assert.equal(args.at(-2), '018f6f4a-4ec8-7d31-a852-0242ac120002');
    assert.equal(args.at(-1), 'Continue the task');

    const overridden = await runTaskScript(continueTaskPath, {
        handle: initialPayload.continuation.handle,
        prompt: 'Continue with selected model',
        model: 'gpt-task-selected',
    }, env);
    assert.equal(overridden.code, 0, overridden.stderr);
    const overrideArgs = JSON.parse(await fs.readFile(argsPath, 'utf8'));
    assert.equal(overrideArgs[overrideArgs.indexOf('--model') + 1], 'gpt-task-selected');
    assert.equal(overrideArgs.at(-1), 'Continue with selected model');
});

test('failed Codex execution still returns a continuation when the thread exists', async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-agent-failure-'));
    const projectDir = path.join(temporaryDirectory, 'project');
    const continuationStore = path.join(temporaryDirectory, 'continuations');
    await fs.mkdir(projectDir);
    const fakeBin = await makeFakeCodexBin(temporaryDirectory);
    const result = await runTaskScript(executeTaskPath, {
        prompt: 'Fail after creating the thread',
        projectDir,
    }, {
        CODEX_BIN: fakeBin,
        CODEX_ARGS_PATH: path.join(temporaryDirectory, 'args.json'),
        PLOINKY_CONTINUATION_STORE_DIR: continuationStore,
        FAKE_CODEX_FAIL: '1',
    });

    assert.equal(result.code, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.continuation.toolName, 'continue-task');
    assert.match(payload.continuation.handle, /^[0-9a-f-]{36}$/i);
    assert.match(result.stderr, /Codex task failed with exit code 1/);
});

test('cancelled Codex execution saves the observed thread before exiting', async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-agent-cancelled-'));
    const projectDir = path.join(temporaryDirectory, 'project');
    const continuationStore = path.join(temporaryDirectory, 'continuations');
    await fs.mkdir(projectDir);
    const fakeBin = await makeFakeCodexBin(temporaryDirectory);

    const result = await runTaskScript(executeTaskPath, {
        prompt: 'Stop Codex after thread creation',
        projectDir,
    }, {
        CODEX_BIN: fakeBin,
        CODEX_ARGS_PATH: path.join(temporaryDirectory, 'args.json'),
        PLOINKY_CONTINUATION_STORE_DIR: continuationStore,
        FAKE_CODEX_WAIT_MS: '1000',
    }, { signalAfterMs: 100 });

    assert.equal(result.code, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.continuation.toolName, 'continue-task');
    const record = JSON.parse(await fs.readFile(
        path.join(continuationStore, `${payload.continuation.handle}.json`),
        'utf8',
    ));
    assert.equal(record.threadId, '018f6f4a-4ec8-7d31-a852-0242ac120002');
});
