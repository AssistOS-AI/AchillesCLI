import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
    executeCodexModels,
    listCodexModels,
} from '../openai-api/models.mjs';

function operationRuntime() {
    const calls = [];
    return {
        calls,
        async launch(input, lifecycle) {
            calls.push({ input, lifecycle });
            const child = new EventEmitter();
            child.stdin = new PassThrough();
            child.stdout = new PassThrough();
            child.stderr = new PassThrough();
            const requests = [];
            child.stdin.setEncoding('utf8');
            child.stdin.on('data', (chunk) => {
                for (const line of String(chunk).trim().split('\n')) {
                    if (line) requests.push(JSON.parse(line));
                }
            });
            setImmediate(() => {
                child.stdout.write(`${JSON.stringify({ id: 1, result: {} })}\n`);
                setImmediate(() => {
                    child.stdout.write(`${JSON.stringify({
                        id: 2,
                        result: {
                            data: [{
                                id: 'gpt-5.6-sol',
                                displayName: 'GPT-5.6 SOL',
                                contextWindow: 200000,
                                supportsImages: true,
                            }],
                        },
                    })}\n`);
                });
            });
            return {
                child,
                completion: new Promise(() => {}),
                launch: {
                    helper: '/usr/local/libexec/ploinky-bwrap-launch',
                    provider: 'codex',
                    mode: 'operation',
                    workdir: null,
                    cwd: '/workspace/operation',
                },
                requests,
            };
        },
    };
}

test('Codex models run app-server only through the private operation runtime', async () => {
    const runtime = operationRuntime();
    const models = await listCodexModels({ providerRuntime: runtime });

    assert.equal(runtime.calls.length, 1);
    assert.deepEqual(runtime.calls[0], {
        input: {
            command: ['/home/agent/.local/bin/codex', 'app-server', '--stdio'],
        },
        lifecycle: { stdio: ['pipe', 'pipe', 'pipe'] },
    });
    assert.deepEqual(models, [{
        id: 'gpt-5.6-sol',
        object: 'model',
        modelId: 'gpt-5.6-sol',
        providerModelId: 'gpt-5.6-sol',
        displayName: 'GPT-5.6 SOL',
        contextWindow: 200000,
        maxOutputTokens: null,
        supportsTools: true,
        supportsStreaming: false,
        supportsVision: true,
        tags: ['coding-agent'],
        metadata: {
            codexModel: 'gpt-5.6-sol',
            description: '',
            defaultReasoningEffort: null,
            reasoningEfforts: [],
        },
        execution: { model: 'gpt-5.6-sol' },
    }]);
});

test('Codex models return the exact provider endpoint response envelope', async () => {
    const runtime = operationRuntime();
    const result = await executeCodexModels(
        { endpoint: 'openai.models' },
        { providerRuntime: runtime },
    );
    assert.equal(result.ok, true);
    assert.equal(result.response.object, 'list');
    assert.equal(result.response.data[0].id, 'gpt-5.6-sol');
    assert.deepEqual(Object.keys(result).sort(), ['ok', 'response']);
});

test('Codex models have no direct provider execution fallback', async () => {
    const source = await fs.readFile(new URL('../openai-api/models.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /node:child_process|resolveCodexBinary|\bspawn\s*\(/u);
    await assert.rejects(
        () => listCodexModels({}),
        (error) => error?.code === 'PLOINKY_PROVIDER_RUNTIME_REQUIRED',
    );
});

test('Codex models manifest uses the named operation module without a shell command', async () => {
    const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
    assert.deepEqual(manifest.endpoints.models.providerExecution, {
        provider: 'codex',
        mode: 'operation',
        module: '/code/openai-api/models.mjs',
        export: 'executeCodexModels',
    });
    assert.equal(manifest.endpoints.models.command, undefined);
    assert.equal(manifest.endpoints.models.args, undefined);
    assert.equal(manifest.endpoints.models.cwd, undefined);
});
