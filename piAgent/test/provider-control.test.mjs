import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
    __testables as controlTestables,
    executeTaskSessionControl,
} from '../scripts/task-session-control.mjs';
import {
    __testables as extensionTestables,
    executeControlCommand,
} from '../extensions/ploinky-control.mjs';

const HANDLE = '123e4567-e89b-42d3-a456-426614174000';

function operationRuntime(response, {
    result = { code: 0, signal: null },
    stderr = '',
} = {}) {
    const calls = [];
    return {
        provider: 'pi',
        mode: 'operation',
        calls,
        async launch(input, lifecycle) {
            calls.push({ input, lifecycle });
            const child = new EventEmitter();
            child.stdin = new PassThrough();
            child.stdout = new PassThrough();
            child.stderr = new PassThrough();
            let stdin = '';
            child.stdin.setEncoding('utf8');
            child.stdin.on('data', (chunk) => { stdin += chunk; });
            const completion = new Promise((resolve) => {
                child.stdin.on('end', () => setImmediate(() => {
                    child.stdout.end(`${controlTestables.RESPONSE_MARKER}${Buffer.from(
                        JSON.stringify(response),
                    ).toString('base64url')}\n`);
                    child.stderr.end(stderr);
                    resolve(result);
                }));
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
                get stdin() { return stdin; },
            };
        },
    };
}

test('PI control extension describes login methods and completes one-step API-key login', async () => {
    const calls = [];
    const runtime = {
        getProviders() {
            return [{
                id: 'anthropic',
                name: 'Anthropic',
                auth: {
                    apiKey: { login: true, name: 'API key' },
                    oauth: { login: true, name: 'Browser' },
                },
            }];
        },
        async login(provider, method, interaction) {
            calls.push({ provider, method });
            assert.equal(await interaction.prompt({ type: 'secret', message: 'Key' }), 'provider-secret');
        },
    };
    const dependencies = {
        createModelRuntime: async () => runtime,
        readContinuationRecord(handle) {
            assert.equal(handle, HANDLE);
            return { projectDir: '/workspace/project' };
        },
    };

    const catalog = await executeControlCommand({
        operation: 'login_describe',
        handle: HANDLE,
    }, dependencies);
    assert.equal(catalog.ok, true);
    assert.deepEqual(catalog.response.providers, [{
        key: 'anthropic',
        label: 'Anthropic',
        methods: [
            { key: 'api_key', kind: 'api_key', label: 'API key' },
            { key: 'oauth', kind: 'manual_oauth_code', label: 'Browser' },
        ],
    }]);

    const completed = await executeControlCommand({
        operation: 'login_start',
        handle: HANDLE,
        provider: 'anthropic',
        method: 'api_key',
        apiKey: 'provider-secret',
    }, dependencies);
    assert.deepEqual(completed, {
        ok: true,
        response: {
            type: 'login-flow',
            version: 1,
            status: 'completed',
            provider: 'anthropic',
            method: 'api_key',
        },
    });
    assert.deepEqual(calls, [{ provider: 'anthropic', method: 'api_key' }]);

    runtime.login = async () => {
        throw new Error('provider rejected provider-secret');
    };
    const failed = await executeControlCommand({
        operation: 'login_start',
        handle: HANDLE,
        provider: 'anthropic',
        method: 'api_key',
        apiKey: 'provider-secret',
    }, dependencies);
    assert.equal(failed.ok, false);
    assert.equal(failed.code, 'PLOINKY_PI_LOGIN_FAILED');
    assert.doesNotMatch(failed.error, /provider-secret/);
    assert.match(failed.error, /\[REDACTED\]/);
});

test('PI one-shot control extension leaves retained OAuth lifecycle to the session controller', async () => {
    const dependencies = {
        createModelRuntime: async () => ({
            getProviders: () => [{
                id: 'openai-codex',
                name: 'OpenAI Codex',
                auth: { oauth: { login: true, loginLabel: 'Device login' } },
            }],
        }),
        readContinuationRecord: () => ({ projectDir: '/workspace/project' }),
    };
    const result = await executeControlCommand({
        operation: 'login_start',
        provider: 'openai-codex',
        method: 'oauth',
        handle: HANDLE,
    }, dependencies);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'PLOINKY_PROVIDER_LOGIN_RETAINED_REQUIRED');

    await assert.rejects(
        executeControlCommand({
            operation: 'login_start',
            provider: 'openai-codex',
            method: 'oauth',
            handle: HANDLE,
            secretResponse: 'legacy-secret',
        }, dependencies),
        (error) => error instanceof TypeError && !error.message.includes('legacy-secret'),
    );
});

test('PI login status/respond/cancel are pure AgentServer session controls', async () => {
    const state = {
        type: 'login-flow',
        version: 1,
        flowId: 'login:11111111-2222-4333-8444-555555555555',
        continuationHandle: 'h'.repeat(43),
        provider: 'openai-codex',
        method: 'oauth',
        status: 'waiting',
        prompt: { type: 'manual_code', seq: 1, nonce: 'nonce-0000000001' },
    };
    const calls = [];
    const operationSessions = {
        async getLoginStatus(control) {
            calls.push(['status', control]);
            return state;
        },
        async respondToLogin(control, response) {
            calls.push(['respond', control, response]);
            return { ...state, status: 'running', prompt: undefined };
        },
        async cancelLogin(control) {
            calls.push(['cancel', control]);
            return { ...state, status: 'cancelled', prompt: undefined };
        },
    };
    const control = {
        flowId: state.flowId,
        continuationHandle: state.continuationHandle,
    };

    const status = await executeTaskSessionControl({
        input: { operation: 'login_status', ...control },
    }, { operationSessions });
    assert.deepEqual(status, { ok: true, response: state });

    const running = await executeTaskSessionControl({
        input: {
            operation: 'login_respond',
            ...control,
            seq: 1,
            nonce: 'nonce-0000000001',
            response: 'manual-secret',
        },
    }, { operationSessions });
    assert.equal(running.response.status, 'running');
    assert.equal(JSON.stringify(running).includes('manual-secret'), false);

    const cancelled = await executeTaskSessionControl({
        input: { operation: 'login_cancel', ...control },
    }, { operationSessions });
    assert.equal(cancelled.response.status, 'cancelled');
    assert.deepEqual(calls, [
        ['status', control],
        ['respond', control, {
            seq: 1,
            nonce: 'nonce-0000000001',
            response: 'manual-secret',
        }],
        ['cancel', control],
    ]);
});

test('PI login controls reject legacy and operation-inapplicable fields before any boundary', async () => {
    const control = {
        flowId: 'login:11111111-2222-4333-8444-555555555555',
        continuationHandle: 'h'.repeat(43),
    };
    const context = {
        operationSessions: new Proxy({}, {
            get() { throw new Error('session registry must not be reached'); },
        }),
        providerRuntime: new Proxy({}, {
            get() { throw new Error('provider boundary must not be reached'); },
        }),
    };
    for (const input of [
        { operation: 'login_status', ...control, handle: HANDLE },
        { operation: 'login_cancel', ...control, response: 'ignored-secret' },
        {
            operation: 'login_respond',
            ...control,
            seq: 1,
            nonce: 'nonce-0000000001',
            secretResponse: 'legacy-secret',
        },
    ]) {
        await assert.rejects(
            executeTaskSessionControl({ input }, context),
            (error) => error?.code === 'PLOINKY_PROVIDER_INPUT_INVALID'
                && !error.message.includes('secret'),
        );
    }
});

test('PI task session control sends secrets only over provider stdin inside one operation boundary', async () => {
    const response = {
        ok: true,
        response: {
            type: 'login-flow',
            version: 1,
            status: 'completed',
            provider: 'anthropic',
            method: 'api_key',
        },
    };
    const runtime = operationRuntime(response);
    const result = await executeTaskSessionControl({
        tool: 'task-session-control',
        input: {
            operation: 'login_start',
            handle: HANDLE,
            provider: 'anthropic',
            method: 'api_key',
            apiKey: 'provider-secret',
        },
    }, { providerRuntime: runtime, signal: new AbortController().signal });

    assert.deepEqual(result, response);
    assert.equal(runtime.calls.length, 1);
    assert.deepEqual(runtime.calls[0], {
        input: {
            command: [
                '/home/agent/.local/bin/pi',
                '--print',
                '--no-session',
                '--extension',
                '/code/extensions/ploinky-soul.mjs',
                '--extension',
                '/code/extensions/ploinky-control.mjs',
            ],
        },
        lifecycle: { stdio: ['pipe', 'pipe', 'pipe'] },
    });
    assert.equal(JSON.stringify(runtime.calls).includes('provider-secret'), false);
});

test('PI task session control never returns provider output for a secret-bearing failure', async () => {
    const secret = 'provider-secret-canary';
    const encodedSecretEnvelope = Buffer.from(JSON.stringify({ apiKey: secret })).toString('base64url');
    const runtime = operationRuntime(null, {
        result: { code: 1, signal: null },
        stderr: `provider echoed ${secret} ${encodedSecretEnvelope}`,
    });

    await assert.rejects(
        () => executeTaskSessionControl({
            input: {
                operation: 'login_start',
                handle: HANDLE,
                provider: 'anthropic',
                method: 'api_key',
                apiKey: secret,
            },
        }, { providerRuntime: runtime }),
        (error) => {
            assert.equal(error?.code, 'PLOINKY_PI_CONTROL_FAILED');
            assert.doesNotMatch(error.message, new RegExp(secret));
            assert.doesNotMatch(error.message, new RegExp(encodedSecretEnvelope));
            assert.match(error.message, /PI control failed/);
            return true;
        },
    );
});

test('PI control manifest and sources have no shell, detached worker, env, or direct import fallback', async () => {
    const config = JSON.parse(await fs.readFile(new URL('../mcp-config.json', import.meta.url), 'utf8'));
    const tool = config.tools.find((entry) => entry.name === 'task-session-control');
    assert.deepEqual(tool.providerExecution, {
        provider: 'pi',
        mode: 'operation',
        module: '/code/scripts/task-session-control.mjs',
        export: 'executeTaskSessionControl',
    });
    for (const field of ['continuationHandle', 'seq', 'nonce']) {
        assert.equal(Object.hasOwn(tool.inputSchema, field), true, field);
    }
    assert.equal(tool.inputSchema.handle.optional, true);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(Object.hasOwn(tool.inputSchema, 'secretResponse'), false);
    assert.equal(Object.hasOwn(tool.inputSchema, 'inputs'), false);
    for (const field of ['command', 'args', 'cwd', 'env']) {
        assert.equal(Object.hasOwn(tool, field), false, field);
    }
    const manifest = JSON.parse(await fs.readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
    assert.equal(manifest.env, undefined);

    for (const sourceFile of [
        '../scripts/task-session-control.mjs',
        '../extensions/ploinky-control.mjs',
    ]) {
        const source = await fs.readFile(new URL(sourceFile, import.meta.url), 'utf8');
        for (const forbidden of [
            'node:child_process',
            'login-flow-store',
            'pi-login-worker',
            'pi-model-runtime',
            'process.env',
            '/root',
            'detached',
        ]) {
            assert.equal(source.includes(forbidden), false, `${sourceFile}: ${forbidden}`);
        }
    }
    assert.equal(extensionTestables.MODEL_RUNTIME_MODULE.startsWith('/home/agent/'), true);
    for (const legacyFile of [
        '../scripts/login-flow-store.mjs',
        '../scripts/pi-login-worker.mjs',
        '../scripts/pi-model-runtime.mjs',
        '../scripts/scoped-soul-broker.mjs',
    ]) {
        await assert.rejects(fs.access(new URL(legacyFile, import.meta.url)), undefined, legacyFile);
    }
});
