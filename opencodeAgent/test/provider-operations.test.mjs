import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
    executeChatCompletion,
} from '../openai-api/chat-completions.mjs';
import {
    listOpenCodeModelsEndpoint,
} from '../openai-api/models.mjs';

function operationRuntime(outputs) {
    const queue = [...outputs];
    const calls = [];
    return {
        provider: 'opencode',
        mode: 'operation',
        calls,
        operationContinued: false,
        resolveHomeState(resolver) {
            return resolver({
                homePath: '/home/agent',
                provider: 'opencode',
                runtimeKind: 'bwrap',
            });
        },
        continueOperation() {
            this.operationContinued = true;
            return this.mode;
        },
        async launch(input, lifecycle) {
            const next = queue.shift() ?? {};
            const child = new EventEmitter();
            child.stdout = new PassThrough();
            child.stderr = new PassThrough();
            child.kill = async () => true;
            const launch = Object.freeze({
                helper: '/usr/local/libexec/ploinky-bwrap-launch',
                provider: 'opencode',
                mode: 'operation',
                workdir: null,
                cwd: '/workspace/operation',
            });
            calls.push({ input, lifecycle, launch });
            const completion = new Promise((resolve) => setImmediate(() => {
                child.stdout.end(next.stdout || '');
                child.stderr.end(next.stderr || '');
                resolve({
                    code: next.code ?? 0,
                    signal: next.signal ?? null,
                    launch,
                });
            }));
            return { child, completion, launch };
        },
    };
}

test('OpenCode models endpoint uses one private canonical operation and exact response envelope', async () => {
    const runtime = operationRuntime([{
        stdout: `soul/fast\n{
            "id":"fast",
            "providerID":"soul",
            "name":"Fast",
            "cost":{"input":0,"output":0},
            "capabilities":{"toolcall":true,"input":{}}
        }\n`,
    }]);

    const result = await listOpenCodeModelsEndpoint({ endpoint: 'openai.models' }, {
        providerRuntime: runtime,
        signal: new AbortController().signal,
    });

    assert.equal(result.ok, true);
    assert.equal(result.response.object, 'list');
    assert.equal(result.response.data[0].id, 'soul/fast');
    assert.equal(runtime.calls.length, 1);
    assert.deepEqual(runtime.calls[0].input, {
        command: ['/home/agent/.opencode/bin/opencode', 'models', '--verbose'],
    });
    assert.deepEqual(runtime.calls[0].lifecycle.stdio, ['ignore', 'pipe', 'pipe']);
    assert.equal(runtime.calls[0].launch.mode, 'operation');
    assert.equal(runtime.calls[0].launch.cwd, '/workspace/operation');
});

test('OpenCode chat endpoint has no real-workspace input and uses the operation boundary', async () => {
    const runtime = operationRuntime([{ stdout: 'operation answer\n' }]);
    const result = await executeChatCompletion({
        request: {
            model: 'soul/plan',
            messages: [{ role: 'user', content: 'Explain the patch.' }],
        },
    }, { providerRuntime: runtime, signal: new AbortController().signal });

    assert.equal(result.ok, true);
    assert.equal(result.response.object, 'chat.completion');
    assert.equal(result.response.choices[0].message.content, 'operation answer');
    assert.equal(runtime.calls.length, 1);
    assert.deepEqual(Object.keys(runtime.calls[0].input), ['command']);
    assert.deepEqual(runtime.calls[0].input.command.slice(0, 4), [
        '/home/agent/.opencode/bin/opencode',
        'run',
        '--auto',
        '--model',
    ]);
    assert.equal(runtime.calls[0].input.command.includes('--dir'), false);
    assert.equal(JSON.stringify(runtime.calls[0]).includes('WORKSPACE_PATH'), false);
});

test('OpenCode endpoint input failures do not fake success or seek a runtime fallback', async () => {
    await assert.rejects(
        executeChatCompletion({ request: { messages: [] } }, {}),
        (error) => error?.code === 'PLOINKY_PROVIDER_RUNTIME_INPUT_INVALID',
    );
    await assert.rejects(
        listOpenCodeModelsEndpoint({}, {}),
        (error) => error?.code === 'PLOINKY_PROVIDER_RUNTIME_REQUIRED',
    );
});

test('OpenCode production sources contain no direct provider spawn or generated credential fallback', async () => {
    const sourceFiles = [
        '../openai-api/chat-completions.mjs',
        '../openai-api/models.mjs',
        '../scripts/continue-task.mjs',
        '../scripts/login-operation-sessions.mjs',
        '../scripts/login-methods.mjs',
        '../scripts/opencode-login-output.mjs',
        '../scripts/opencode-runner.mjs',
        '../scripts/task-session-control.mjs',
    ];
    for (const sourceFile of sourceFiles) {
        const source = await fs.readFile(new URL(sourceFile, import.meta.url), 'utf8');
        assert.doesNotMatch(source, /node:child_process|\bspawn\s*\(/, sourceFile);
        assert.doesNotMatch(source, /PLOINKY_ENV_SOURCE_|PLOINKY_AGENT_API_KEY/, sourceFile);
        assert.doesNotMatch(source, /HOME\s*\|\|\s*['"]\/root['"]/, sourceFile);
        assert.doesNotMatch(source, /\bserve\b|node:net/, sourceFile);
    }
    const config = JSON.parse(await fs.readFile(
        new URL('../mcp-config.json', import.meta.url),
        'utf8',
    ));
    for (const tool of config.tools) {
        assert.ok(tool.providerExecution, tool.name);
        assert.equal('command' in tool, false, tool.name);
    }
    const manifest = JSON.parse(await fs.readFile(
        new URL('../manifest.json', import.meta.url),
        'utf8',
    ));
    for (const endpoint of ['chatCompletions', 'models']) {
        assert.equal(manifest.endpoints[endpoint].providerExecution.mode, 'operation');
        assert.equal('command' in manifest.endpoints[endpoint], false);
    }
    const legacyBroker = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../scripts/scoped-soul-broker.mjs',
    );
    await assert.rejects(fs.access(legacyBroker));
    for (const legacyPath of [
        '../scripts/opencode-control-server.mjs',
        '../scripts/opencode-auth.mjs',
        '../scripts/opencode-login-worker.mjs',
        '../scripts/login-flow-store.mjs',
    ]) {
        await assert.rejects(fs.access(new URL(legacyPath, import.meta.url)));
    }
});
