import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
    executePiModels,
    listPiModels,
    parsePiModelsTable,
} from '../openai-api/models.mjs';

const MODEL_TABLE = [
    'provider      model  context  max-out  thinking  images',
    'ploinky-soul  deep   200K     32K      yes       yes',
    'ploinky-soul  fast   200K     32K      yes       yes',
    'ploinky-soul  plan   200K     32K      yes       yes',
    'other         nope   1K       1K       no        no',
    '',
].join('\n');

function operationRuntime({ stdout = MODEL_TABLE, stderr = '', result = { code: 0, signal: null } } = {}) {
    const calls = [];
    return {
        calls,
        provider: 'pi',
        mode: 'operation',
        async launch(input, lifecycle) {
            calls.push({ input, lifecycle });
            const child = new EventEmitter();
            child.stdout = new PassThrough();
            child.stderr = new PassThrough();
            const completion = new Promise((resolve) => {
                setImmediate(() => {
                    child.stdout.end(stdout);
                    child.stderr.end(stderr);
                    resolve(result);
                });
            });
            return {
                child,
                completion,
                launch: {
                    helper: '/usr/local/libexec/ploinky-bwrap-launch',
                    provider: 'pi',
                    mode: 'operation',
                    workdir: null,
                    cwd: '/workspace/operation',
                },
            };
        },
    };
}

test('PI model parser exposes only the scoped Soul model contract', () => {
    assert.deepEqual(parsePiModelsTable(MODEL_TABLE).map((model) => model.id), [
        'deep',
        'fast',
        'plan',
    ]);
    assert.deepEqual(parsePiModelsTable(MODEL_TABLE)[0], {
        id: 'deep',
        object: 'model',
        modelId: 'deep',
        providerModelId: 'ploinky-soul/deep',
        displayName: 'Soul deep',
        contextWindow: 200000,
        maxOutputTokens: 32000,
        supportsTools: true,
        supportsStreaming: false,
        supportsVision: true,
        tags: ['coding-agent'],
        metadata: {
            piProvider: 'ploinky-soul',
            piModelId: 'deep',
            supportsThinking: true,
        },
        execution: { model: 'deep' },
    });
});

test('PI models run only through the canonical private operation runtime', async () => {
    const runtime = operationRuntime();
    const models = await listPiModels({ providerRuntime: runtime });

    assert.deepEqual(models.map((model) => model.id), ['deep', 'fast', 'plan']);
    assert.equal(runtime.calls.length, 1);
    assert.deepEqual(runtime.calls[0], {
        input: {
            command: [
                '/home/agent/.local/bin/pi',
                '--extension',
                '/code/extensions/ploinky-soul.mjs',
                '--list-models',
                'ploinky-soul',
            ],
        },
        lifecycle: { stdio: ['ignore', 'pipe', 'pipe'] },
    });
});

test('PI models return the exact provider endpoint response envelope', async () => {
    const runtime = operationRuntime();
    const result = await executePiModels(
        { endpoint: 'openai.models' },
        { providerRuntime: runtime },
    );
    assert.deepEqual(Object.keys(result).sort(), ['ok', 'response']);
    assert.equal(result.ok, true);
    assert.equal(result.response.object, 'list');
    assert.deepEqual(result.response.data.map((model) => model.id), ['deep', 'fast', 'plan']);
});

test('PI models fail closed on runtime mismatch, provider failure, or unapproved output', async () => {
    await assert.rejects(
        () => listPiModels({}),
        (error) => error?.code === 'PLOINKY_PROVIDER_RUNTIME_REQUIRED',
    );
    await assert.rejects(
        () => listPiModels({ providerRuntime: operationRuntime({
            stderr: 'provider unavailable',
            result: { code: 1, signal: null },
        }) }),
        (error) => error?.code === 'PLOINKY_PI_MODELS_FAILED' && /provider unavailable/.test(error.message),
    );
    await assert.rejects(
        () => listPiModels({ providerRuntime: operationRuntime({
            stdout: 'provider  model  context  max-out  thinking  images\nother  nope  1K  1K  no  no\n',
        }) }),
        (error) => error?.code === 'PLOINKY_PI_MODELS_INVALID',
    );
});

test('PI models contain no direct provider execution or credential fallback', async () => {
    const source = await fs.readFile(new URL('../openai-api/models.mjs', import.meta.url), 'utf8');
    for (const forbidden of [
        'node:child_process',
        'pi-model-runtime',
        'process.env',
        '/root',
        'PLOINKY_TASK_BROKER_KEY',
    ]) {
        assert.equal(source.includes(forbidden), false, forbidden);
    }
});

test('PI models manifest uses the named operation module without a shell command', async () => {
    const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
    assert.deepEqual(manifest.endpoints.models.providerExecution, {
        provider: 'pi',
        mode: 'operation',
        module: '/code/openai-api/models.mjs',
        export: 'executePiModels',
    });
    assert.equal(manifest.endpoints.models.command, undefined);
    assert.equal(manifest.endpoints.models.args, undefined);
    assert.equal(manifest.endpoints.models.cwd, undefined);
});
