import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

import {
    __testables as piRunnerTestables,
    createPiJsonEventParser,
    readCurrentPiModel,
} from '../scripts/execute-task.mjs';

const executeTaskPath = new URL('../scripts/execute-task.mjs', import.meta.url).pathname;
const continueTaskPath = new URL('../scripts/continue-task.mjs', import.meta.url).pathname;
const fakeBwrapPath = new URL('../../tests/helpers/fake-bwrap.sh', import.meta.url).pathname;
const taskHarnessPath = new URL('../../tests/helpers/run-agent-task.mjs', import.meta.url).pathname;

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

async function makeFakePiBin(directory) {
    const binPath = path.join(directory, 'fake-pi.mjs');
    await fs.writeFile(binPath, `#!${process.execPath}
import fs from 'node:fs';

fs.writeFileSync(process.env.PI_ARGS_PATH, JSON.stringify(process.argv.slice(2)));
if (process.env.PI_ENV_PATH) {
    fs.writeFileSync(process.env.PI_ENV_PATH, JSON.stringify({
        home: process.env.HOME,
        agentDir: process.env.PI_CODING_AGENT_DIR || null,
    }));
}
const emit = (event) => fs.writeSync(1, JSON.stringify(event) + '\\n');
emit({ type: 'session', id: 'ignored-session-metadata' });
if (process.env.FAKE_PI_ASSISTANT_ERROR === '1') {
    emit({ type: 'message_start', message: { role: 'assistant', content: [] } });
    emit({
        type: 'message_end',
        message: {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage: 'Your authentication token has been invalidated. Please try signing in again.',
            diagnostics: [{
                type: 'provider_transport_failure',
                error: { message: 'WebSocket error', stack: 'hidden provider stack' },
            }],
        },
    });
    process.exit(0);
}
emit({ type: 'message_start', message: { role: 'assistant', content: [] } });
emit({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta: 'Pi ' },
});
await new Promise((resolve) => setTimeout(
    resolve,
    Number(process.env.FAKE_PI_WAIT_MS || 25),
));
emit({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', delta: 'answer' },
});
emit({
    type: 'message_end',
    message: {
        role: 'assistant',
        content: [{
            type: 'text',
            text: 'Pi answer',
            textSignature: 'ignored-text-signature',
        }],
    },
});
emit({
    type: 'agent_end',
    messages: [{
        role: 'assistant',
        content: [{
            type: 'thinking',
            thinking: 'ignored thinking',
            thinkingSignature: { encrypted_content: 'ignored-encrypted-content' },
        }, { type: 'text', text: 'Pi answer' }],
    }],
});
if (process.env.FAKE_PI_FAIL === '1') {
    fs.writeSync(2, 'insufficient credits');
    process.exitCode = 1;
}
`, 'utf8');
    await fs.chmod(binPath, 0o755);
    return binPath;
}

test('PI JSON parser emits readable live text without lifecycle metadata or duplicates', () => {
    let visible = '';
    const parser = createPiJsonEventParser({
        onText(text) {
            visible += text;
        },
    });
    const lines = [
        JSON.stringify({ type: 'session', secret: 'hidden-session-value' }),
        JSON.stringify({
            type: 'tool_execution_update',
            toolCallId: 'tool-1',
            partialResult: { content: [{ type: 'text', text: 'first' }] },
        }),
        JSON.stringify({
            type: 'tool_execution_update',
            toolCallId: 'tool-1',
            partialResult: { content: [{ type: 'text', text: 'first\nsecond\n' }] },
        }),
        JSON.stringify({
            type: 'tool_execution_end',
            toolCallId: 'tool-1',
            result: { content: [{ type: 'text', text: 'first\nsecond\n' }] },
        }),
        JSON.stringify({
            type: 'message_start',
            message: { role: 'assistant', content: [] },
        }),
        JSON.stringify({
            type: 'message_update',
            assistantMessageEvent: { type: 'thinking_delta', delta: 'hidden reasoning' },
        }),
        JSON.stringify({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', delta: 'Final ' },
        }),
        JSON.stringify({
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', delta: 'answer' },
        }),
        JSON.stringify({
            type: 'message_end',
            message: {
                role: 'assistant',
                content: [{ type: 'text', text: 'Final answer', textSignature: 'hidden' }],
            },
        }),
        JSON.stringify({
            type: 'turn_end',
            message: {
                role: 'assistant',
                content: [{
                    type: 'thinking',
                    thinkingSignature: { encrypted_content: 'hidden-encrypted-content' },
                }],
            },
        }),
    ].join('\n') + '\n';
    const splitAt = lines.indexOf('"first') + 4;
    parser.push(Buffer.from(lines.slice(0, splitAt)));
    parser.push(Buffer.from(lines.slice(splitAt)));
    parser.finish();

    assert.equal(visible, 'first\nsecond\nFinal answer');
    assert.equal(parser.getFinalOutputText(), 'Final answer');
    assert.doesNotMatch(visible, /hidden|session|thinking|signature/i);
});

test('PI JSON parser captures assistant errors without leaking diagnostics into live output', () => {
    let visible = '';
    const parser = createPiJsonEventParser({
        onText(text) {
            visible += text;
        },
    });
    parser.push(Buffer.from(`${JSON.stringify({
        type: 'message_end',
        message: {
            role: 'assistant',
            content: [],
            stopReason: 'error',
            errorMessage: 'Authentication failed.',
            diagnostics: [{ error: { message: 'transport failed', stack: 'hidden stack' } }],
        },
    })}\n`));
    parser.finish();

    assert.equal(visible, '');
    assert.equal(parser.getFinalOutputText(), '');
    assert.equal(parser.getErrorMessage(), 'Authentication failed.');
});

test('PI retained output is byte bounded without an elapsed task timeout', () => {
    const retained = piRunnerTestables.appendBoundedTail('', '€'.repeat(20_000));
    assert.ok(Buffer.byteLength(retained, 'utf8') <= 16 * 1024);
    assert.match(retained, /€+$/u);
});

test('PI capability failure returns the stable code before project or session mutation', async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-capability-failure-test-'));
    const workspaceRoot = path.join(temporaryDirectory, 'workspace');
    const projectDir = path.join(workspaceRoot, 'missing-project');
    const continuationStore = path.join(temporaryDirectory, 'continuations');
    const sessionRoot = path.join(temporaryDirectory, 'sessions');
    await fs.mkdir(workspaceRoot);
    const result = await runTaskScript(executeTaskPath, {
        prompt: 'must not run',
        projectDir,
    }, {
        PI_BIN: path.join(temporaryDirectory, 'missing-pi'),
        PLOINKY_CONTINUATION_STORE_DIR: continuationStore,
        PLOINKY_PI_SESSION_DIR: sessionRoot,
        PLOINKY_WORKSPACE_ROOT: workspaceRoot,
        TEST_TASK_BWRAP_MODE: 'fail',
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /^PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE:/);
    assert.deepEqual(JSON.parse(result.stdout), {
        ok: false,
        outputText: '',
        error: 'PI task sandbox rejected projectDir: nested Bubblewrap capability is unavailable (private: test capability unavailable; empty: test capability unavailable)',
        code: 'PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE',
        status: 422,
    });
    await assert.rejects(fs.access(projectDir));
    await assert.rejects(fs.access(continuationStore));
    await assert.rejects(fs.access(sessionRoot));
});

test('PI wrapper creates a resumable session and returns a continuation handle', async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-agent-test-'));
    const projectDir = path.join(temporaryDirectory, 'project');
    const argsPath = path.join(temporaryDirectory, 'args.json');
    const envPath = path.join(temporaryDirectory, 'env.json');
    const continuationStore = path.join(temporaryDirectory, 'continuations');
    const sessionRoot = path.join(temporaryDirectory, 'sessions');
    await fs.mkdir(projectDir);
    const piBin = await makeFakePiBin(temporaryDirectory);

    const result = await runTaskScript(executeTaskPath, {
        prompt: 'Do the task',
        projectDir,
    }, {
        PI_BIN: piBin,
        PI_ARGS_PATH: argsPath,
        PI_ENV_PATH: envPath,
        PI_CODING_AGENT_DIR: '/root/.pi/agent',
        PLOINKY_CONTINUATION_STORE_DIR: continuationStore,
        PLOINKY_PI_SESSION_DIR: sessionRoot,
        PLOINKY_WORKSPACE_ROOT: projectDir,
    });

    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.outputText, 'Pi answer');
    assert.equal(payload.continuation.toolName, 'continue-task');
    assert.match(payload.continuation.handle, /^[0-9a-f-]{36}$/i);
    assert.equal(result.stderr, 'Pi answer');
    assert.doesNotMatch(result.stderr, /\[pi|start projectDir|exit code/);

    const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
    assert.deepEqual(args.slice(0, 5), [
        '--mode',
        'json',
        '--session-id',
        payload.continuation.handle,
        '--session-dir',
    ]);
    assert.equal(args[5], path.join(sessionRoot, payload.continuation.handle));
    assert.deepEqual(JSON.parse(await fs.readFile(envPath, 'utf8')), {
        home: '/root',
        agentDir: '/root/.pi/agent',
    });
});

test('generated-local PI tasks load the scoped Soul provider extension', async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-soul-task-test-'));
    const projectDir = path.join(temporaryDirectory, 'project');
    const argsPath = path.join(temporaryDirectory, 'args.json');
    await fs.mkdir(projectDir);
    const piBin = await makeFakePiBin(temporaryDirectory);

    const result = await runTaskScript(executeTaskPath, {
        prompt: 'Use Soul.',
        projectDir,
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
    }, {
        PI_BIN: piBin,
        PI_ARGS_PATH: argsPath,
        PLOINKY_CONTINUATION_STORE_DIR: path.join(temporaryDirectory, 'continuations'),
        PLOINKY_PI_SESSION_DIR: path.join(temporaryDirectory, 'sessions'),
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
    assert.equal(args[args.indexOf('--provider') + 1], 'ploinky-soul');
    assert.equal(args[args.indexOf('--model') + 1], 'fast');
    assert.match(args[args.indexOf('--extension') + 1], /ploinky-soul\.mjs$/);
});

test('failed PI task returns and persists its continuation handle', async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-agent-failed-task-test-'));
    const projectDir = path.join(temporaryDirectory, 'project');
    const continuationStore = path.join(temporaryDirectory, 'continuations');
    const argsPath = path.join(temporaryDirectory, 'args.json');
    const sessionRoot = path.join(temporaryDirectory, 'sessions');
    await fs.mkdir(projectDir);
    const piBin = await makeFakePiBin(temporaryDirectory);

    const result = await runTaskScript(executeTaskPath, {
        prompt: 'Use exhausted model',
        projectDir,
    }, {
        PI_BIN: piBin,
        PI_ARGS_PATH: argsPath,
        PLOINKY_CONTINUATION_STORE_DIR: continuationStore,
        PLOINKY_PI_SESSION_DIR: sessionRoot,
        PLOINKY_WORKSPACE_ROOT: projectDir,
        FAKE_PI_FAIL: '1',
    });

    assert.equal(result.code, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.continuation.toolName, 'continue-task');
    assert.match(payload.continuation.handle, /^[0-9a-f-]{36}$/i);
    const record = JSON.parse(await fs.readFile(
        path.join(continuationStore, `${payload.continuation.handle}.json`),
        'utf8',
    ));
    assert.equal(record.sessionId, payload.continuation.handle);
    assert.equal(record.projectDir, await fs.realpath(projectDir));
});

test('PI assistant error fails the task even when the PI process exits successfully', async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-agent-assistant-error-test-'));
    const projectDir = path.join(temporaryDirectory, 'project');
    const continuationStore = path.join(temporaryDirectory, 'continuations');
    await fs.mkdir(projectDir);
    const piBin = await makeFakePiBin(temporaryDirectory);

    const result = await runTaskScript(executeTaskPath, {
        prompt: 'Use invalid authentication',
        projectDir,
    }, {
        PI_BIN: piBin,
        PI_ARGS_PATH: path.join(temporaryDirectory, 'args.json'),
        PLOINKY_CONTINUATION_STORE_DIR: continuationStore,
        PLOINKY_PI_SESSION_DIR: path.join(temporaryDirectory, 'sessions'),
        PLOINKY_WORKSPACE_ROOT: projectDir,
        FAKE_PI_ASSISTANT_ERROR: '1',
    });

    assert.equal(result.code, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.outputText, '');
    assert.equal(payload.continuation.toolName, 'continue-task');
    assert.equal(
        result.stderr,
        'Your authentication token has been invalidated. Please try signing in again.\n',
    );
    assert.doesNotMatch(result.stderr, /WebSocket|hidden provider stack/);
});

test('cancelled PI task returns its preallocated continuation handle', async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-agent-cancelled-task-test-'));
    const projectDir = path.join(temporaryDirectory, 'project');
    const continuationStore = path.join(temporaryDirectory, 'continuations');
    const argsPath = path.join(temporaryDirectory, 'args.json');
    await fs.mkdir(projectDir);
    const piBin = await makeFakePiBin(temporaryDirectory);

    const result = await runTaskScript(executeTaskPath, {
        prompt: 'Stop PI',
        projectDir,
    }, {
        PI_BIN: piBin,
        PI_ARGS_PATH: argsPath,
        PLOINKY_CONTINUATION_STORE_DIR: continuationStore,
        PLOINKY_PI_SESSION_DIR: path.join(temporaryDirectory, 'sessions'),
        PLOINKY_WORKSPACE_ROOT: projectDir,
        FAKE_PI_WAIT_MS: '1000',
    }, { signalAfterPath: argsPath });

    assert.equal(result.code, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.continuation.toolName, 'continue-task');
    const record = JSON.parse(await fs.readFile(
        path.join(continuationStore, `${payload.continuation.handle}.json`),
        'utf8',
    ));
    assert.equal(record.sessionId, payload.continuation.handle);
});

test('PI model lookup uses project settings over persistent global settings', async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-agent-settings-test-'));
    const home = path.join(temporaryDirectory, 'home');
    const projectDir = path.join(temporaryDirectory, 'project');
    assert.deepEqual(readCurrentPiModel({
        projectDir,
        env: { HOME: path.join(temporaryDirectory, 'missing-home') },
    }), {
        provider: '',
        model: '',
        thinking: '',
    });
    await fs.mkdir(path.join(home, '.pi', 'agent'), { recursive: true });
    await fs.mkdir(path.join(projectDir, '.pi'), { recursive: true });
    await fs.writeFile(path.join(home, '.pi', 'agent', 'settings.json'), JSON.stringify({
        defaultProvider: 'xai',
        defaultModel: 'grok-4.5',
        defaultThinkingLevel: 'medium',
    }));
    await fs.writeFile(path.join(projectDir, '.pi', 'settings.json'), JSON.stringify({
        defaultProvider: 'openai',
        defaultModel: 'gpt-5.4-mini',
        defaultThinkingLevel: 'high',
    }));

    assert.deepEqual(readCurrentPiModel({ projectDir, env: { HOME: home } }), {
        provider: 'openai',
        model: 'gpt-5.4-mini',
        thinking: 'high',
    });
});

test('PI continuation reuses the exact session id and session directory', async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-agent-resume-test-'));
    const projectDir = path.join(temporaryDirectory, 'project');
    const argsPath = path.join(temporaryDirectory, 'args.json');
    const continuationStore = path.join(temporaryDirectory, 'continuations');
    const sessionRoot = path.join(temporaryDirectory, 'sessions');
    const home = path.join(temporaryDirectory, 'home');
    await fs.mkdir(projectDir);
    await fs.mkdir(path.join(home, '.pi', 'agent'), { recursive: true });
    await fs.writeFile(path.join(home, '.pi', 'agent', 'settings.json'), JSON.stringify({
        defaultProvider: 'openai',
        defaultModel: 'gpt-5.4-mini',
        defaultThinkingLevel: 'high',
    }));
    const piBin = await makeFakePiBin(temporaryDirectory);
    const env = {
        PI_BIN: piBin,
        PI_ARGS_PATH: argsPath,
        PLOINKY_CONTINUATION_STORE_DIR: continuationStore,
        PLOINKY_PI_SESSION_DIR: sessionRoot,
        PLOINKY_WORKSPACE_ROOT: projectDir,
        HOME: home,
    };
    const initial = await runTaskScript(executeTaskPath, {
        prompt: 'Initial task',
        projectDir,
    }, env);
    assert.equal(initial.code, 0, initial.stderr);
    const firstPayload = JSON.parse(initial.stdout);

    const resumed = await runTaskScript(continueTaskPath, {
        handle: firstPayload.continuation.handle,
        prompt: 'Continue same PI session',
    }, env);
    assert.equal(resumed.code, 0, resumed.stderr);
    const resumedPayload = JSON.parse(resumed.stdout);
    assert.equal(resumedPayload.continuation.handle, firstPayload.continuation.handle);
    const args = JSON.parse(await fs.readFile(argsPath, 'utf8'));
    assert.deepEqual(args.slice(0, 6), [
        '--mode',
        'json',
        '--session-id',
        firstPayload.continuation.handle,
        '--session-dir',
        path.join(sessionRoot, firstPayload.continuation.handle),
    ]);
    assert.equal(args[args.indexOf('--provider') + 1], 'openai');
    assert.equal(args[args.indexOf('--model') + 1], 'gpt-5.4-mini');
    assert.equal(args[args.indexOf('--thinking') + 1], 'high');
    assert.equal(args.at(-1), 'Continue same PI session');

    const overridden = await runTaskScript(continueTaskPath, {
        handle: firstPayload.continuation.handle,
        prompt: 'Continue with selected PI model',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
    }, env);
    assert.equal(overridden.code, 0, overridden.stderr);
    const overrideArgs = JSON.parse(await fs.readFile(argsPath, 'utf8'));
    assert.equal(overrideArgs[overrideArgs.indexOf('--provider') + 1], 'anthropic');
    assert.equal(overrideArgs[overrideArgs.indexOf('--model') + 1], 'claude-sonnet-4-5');
    assert.equal(overrideArgs.includes('--thinking'), false);
    assert.equal(overrideArgs.at(-1), 'Continue with selected PI model');
});
