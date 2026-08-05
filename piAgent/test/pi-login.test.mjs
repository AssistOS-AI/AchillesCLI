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
    createLoginEventReader,
    createLoginResponseReader,
    encodeLoginEventFrame,
    encodeLoginResponseFrame,
} from '../scripts/pi-login-protocol.mjs';
import {
    executeRetainedLogin,
} from '../extensions/ploinky-login.mjs';

const TASK_HANDLE = '123e4567-e89b-42d3-a456-426614174000';
const FLOW_ID = 'login:11111111-2222-4333-8444-555555555555';
const CONTINUATION_HANDLE = 'h'.repeat(43);
const PROMPT = Object.freeze({
    type: 'manual_code',
    seq: 1,
    nonce: 'nonce-0000000001',
});

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function retainedRuntime(initialEvent) {
    const calls = [];
    const completion = deferred();
    const controller = {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        completion: completion.promise,
        launch: {
            helper: '/usr/local/libexec/ploinky-bwrap-launch',
            provider: 'pi',
            mode: 'operation',
            workdir: null,
            cwd: '/workspace/operation',
        },
    };
    return {
        calls,
        completion,
        controller,
        providerRuntime: {
            provider: 'pi',
            mode: 'operation',
            async launchRetainedOperation(input, lifecycle) {
                calls.push({ input, lifecycle });
                const frame = encodeLoginEventFrame(initialEvent);
                setImmediate(() => {
                    controller.stdout.write(frame.subarray(0, 7));
                    controller.stdout.write(frame.subarray(7));
                });
                return controller;
            },
        },
    };
}

test('PI retained OAuth start stages one canonical operation with exact initial state', async () => {
    const initialState = {
        status: 'waiting',
        challenge: {
            type: 'authorization_url',
            verificationUri: 'https://auth.example.test/authorize',
        },
        prompt: PROMPT,
    };
    const runtime = retainedRuntime({ kind: 'state', state: initialState });
    let retainedSpec;
    const operationSessions = {
        async retainLoginOperation(spec) {
            retainedSpec = spec;
            return {
                type: 'login-flow',
                version: 1,
                flowId: FLOW_ID,
                continuationHandle: CONTINUATION_HANDLE,
                provider: spec.authProvider,
                method: spec.method,
                ...spec.initialState,
            };
        },
    };

    const result = await executeTaskSessionControl({
        input: {
            operation: 'login_start',
            handle: TASK_HANDLE,
            provider: 'openai-codex',
            method: 'oauth',
        },
    }, {
        operationSessions,
        providerRuntime: runtime.providerRuntime,
    });

    assert.equal(result.ok, true);
    assert.equal(result.response.flowId, FLOW_ID);
    assert.equal(retainedSpec.controller, runtime.controller);
    assert.equal(retainedSpec.authProvider, 'openai-codex');
    assert.equal(retainedSpec.method, 'oauth');
    assert.deepEqual(retainedSpec.initialState, initialState);
    assert.equal(typeof retainedSpec.onRespond, 'function');
    assert.equal(typeof retainedSpec.onCompletion, 'function');
    assert.equal(runtime.calls.length, 1);
    assert.deepEqual(runtime.calls[0].lifecycle, { stdio: ['pipe', 'pipe', 'pipe'] });
    assert.deepEqual(runtime.calls[0].input.command.slice(0, 7), [
        '/home/agent/.local/bin/pi',
        '--print',
        '--no-session',
        '--extension',
        '/code/extensions/ploinky-login.mjs',
        '/ploinky-login',
        runtime.calls[0].input.command[6],
    ]);
    assert.equal(JSON.stringify(runtime.calls).includes('manual-secret'), false);

    let providerInput = '';
    runtime.controller.stdin.setEncoding('utf8');
    runtime.controller.stdin.on('data', (chunk) => { providerInput += chunk; });
    runtime.controller.stdin.on('data', () => setImmediate(() => {
        runtime.controller.stdout.write(encodeLoginEventFrame({
            kind: 'terminal',
            state: { status: 'completed' },
        }));
        runtime.controller.stdout.end();
        runtime.controller.stderr.end();
        runtime.completion.resolve({ code: 0, signal: null });
    }));
    const published = [];
    await retainedSpec.onRespond({
        ...PROMPT,
        response: 'manual-secret',
        publish(state) { published.push(state); return state; },
    });
    assert.equal(providerInput.includes('manual-secret'), false);
    assert.match(providerInput, /^PLOINKY_PI_LOGIN_RESPONSE [A-Za-z0-9_-]+\n$/);
    assert.equal(JSON.stringify(published).includes('manual-secret'), false);
    assert.deepEqual(await retainedSpec.onCompletion({
        outcome: { code: 0, signal: null },
        publish() { throw new Error('terminal publish forbidden'); },
    }), { status: 'completed' });
});

test('PI login event reader rejects malformed, oversized, and post-terminal frames', async () => {
    for (const chunks of [
        [Buffer.from('PLOINKY_PI_LOGIN_EVENT !!!\n')],
        [Buffer.from(`PLOINKY_PI_LOGIN_EVENT ${'a'.repeat(70 * 1024)}\n`)],
        [
            encodeLoginEventFrame({ kind: 'terminal', state: { status: 'completed' } }),
            encodeLoginEventFrame({ kind: 'state', state: { status: 'running' } }),
        ],
    ]) {
        const stream = new PassThrough();
        const reader = createLoginEventReader(stream);
        for (const chunk of chunks) stream.write(chunk);
        stream.end();
        await assert.rejects(
            reader.nextEvent(),
            (error) => error?.code === 'provider_login_output_invalid',
        );
    }
    for (const verificationUri of [
        'https://',
        'https://user:password@auth.example.test/',
        ' https://auth.example.test/',
    ]) {
        assert.throws(
            () => encodeLoginEventFrame({
                kind: 'state',
                state: {
                    status: 'running',
                    challenge: { type: 'authorization_url', verificationUri },
                },
            }),
            (error) => error?.code === 'provider_login_output_invalid',
        );
    }
});

test('PI response reader accepts one fragmented exact frame and rejects replay', async () => {
    const stream = new PassThrough();
    const reader = createLoginResponseReader(stream);
    const response = {
        seq: PROMPT.seq,
        nonce: PROMPT.nonce,
        response: 'one-secret-response',
    };
    const first = reader.waitForResponse(PROMPT);
    const frame = encodeLoginResponseFrame(response);
    stream.write(frame.subarray(0, 5));
    stream.write(frame.subarray(5));
    assert.equal(await first, 'one-secret-response');

    stream.write(frame);
    await assert.rejects(
        reader.waitForResponse({ ...PROMPT, seq: 2, nonce: 'nonce-0000000002' }),
        (error) => error?.code === 'provider_login_output_invalid'
            && !error.message.includes('one-secret-response'),
    );
});

test('PI response reader rejects malformed and oversized frames without reflecting input', async () => {
    for (const frame of [
        Buffer.from('PLOINKY_PI_LOGIN_RESPONSE !!!\n'),
        Buffer.from(`PLOINKY_PI_LOGIN_RESPONSE ${'a'.repeat(70 * 1024)}\n`),
    ]) {
        const stream = new PassThrough();
        const reader = createLoginResponseReader(stream);
        const pending = reader.waitForResponse(PROMPT);
        stream.end(frame);
        await assert.rejects(
            pending,
            (error) => error?.code === 'provider_login_output_invalid'
                && !error.message.includes('manual-secret'),
        );
    }
});

test('PI retained controller rejects raw and encoded response reflection before publication', async () => {
    const secret = 'manual-secret-canary';
    for (const reflected of [
        secret,
        Buffer.from(secret).toString('base64'),
        Buffer.from(secret).toString('base64url'),
    ]) {
        const runtime = retainedRuntime({
            kind: 'state',
            state: { status: 'waiting', prompt: PROMPT },
        });
        let retainedSpec;
        await executeTaskSessionControl({
            input: {
                operation: 'login_start',
                handle: TASK_HANDLE,
                provider: 'openai-codex',
                method: 'oauth',
            },
        }, {
            providerRuntime: runtime.providerRuntime,
            operationSessions: {
                async retainLoginOperation(spec) {
                    retainedSpec = spec;
                    return {
                        type: 'login-flow',
                        version: 1,
                        flowId: FLOW_ID,
                        continuationHandle: CONTINUATION_HANDLE,
                        provider: spec.authProvider,
                        method: spec.method,
                        ...spec.initialState,
                    };
                },
            },
        });

        runtime.controller.stdin.once('data', () => setImmediate(() => {
            runtime.controller.stdout.write(encodeLoginEventFrame({
                kind: 'state',
                state: {
                    status: 'waiting',
                    challenge: {
                        type: 'authorization_url',
                        verificationUri: `https://auth.example.test/${reflected}`,
                    },
                    prompt: { ...PROMPT, seq: 2, nonce: 'nonce-0000000002' },
                },
            }));
        }));
        const published = [];
        await assert.rejects(
            retainedSpec.onRespond({
                ...PROMPT,
                response: secret,
                publish(state) { published.push(state); return state; },
            }),
            (error) => error?.code === 'provider_login_output_invalid'
                && !error.message.includes(secret),
        );
        assert.equal(JSON.stringify(published).includes(secret), false);
        assert.equal(JSON.stringify(published).includes(reflected), false);
    }
});

test('PI retained controller rejects non-monotonic prompt sequences before publication', async () => {
    const runtime = retainedRuntime({
        kind: 'state',
        state: { status: 'waiting', prompt: PROMPT },
    });
    let retainedSpec;
    await executeTaskSessionControl({
        input: {
            operation: 'login_start',
            handle: TASK_HANDLE,
            provider: 'openai-codex',
            method: 'oauth',
        },
    }, {
        providerRuntime: runtime.providerRuntime,
        operationSessions: {
            async retainLoginOperation(spec) {
                retainedSpec = spec;
                return {
                    type: 'login-flow',
                    version: 1,
                    flowId: FLOW_ID,
                    continuationHandle: CONTINUATION_HANDLE,
                    provider: spec.authProvider,
                    method: spec.method,
                    ...spec.initialState,
                };
            },
        },
    });
    runtime.controller.stdin.once('data', () => setImmediate(() => {
        runtime.controller.stdout.write(encodeLoginEventFrame({
            kind: 'state',
            state: {
                status: 'waiting',
                prompt: { ...PROMPT, nonce: 'nonce-0000000002' },
            },
        }));
    }));
    const published = [];
    await assert.rejects(
        retainedSpec.onRespond({
            ...PROMPT,
            response: 'manual-secret',
            publish(state) { published.push(state); return state; },
        }),
        (error) => error?.code === 'provider_login_output_invalid',
    );
    assert.deepEqual(published, [{ status: 'running' }]);
});

test('PI immediate retained terminal requires a clean serialized process completion', async () => {
    const runtime = retainedRuntime({
        kind: 'terminal',
        state: { status: 'completed' },
    });
    const result = executeTaskSessionControl({
        input: {
            operation: 'login_start',
            handle: TASK_HANDLE,
            provider: 'openai-codex',
            method: 'oauth',
        },
    }, {
        providerRuntime: runtime.providerRuntime,
        operationSessions: {
            retainLoginOperation() { throw new Error('terminal flow must not be retained'); },
        },
    });
    setImmediate(() => {
        runtime.controller.stdout.end();
        runtime.controller.stderr.end('bounded diagnostic');
        runtime.completion.resolve({ code: 1, signal: null });
    });
    await assert.rejects(
        result,
        (error) => error?.code === 'provider_login_failed'
            && !error.message.includes('bounded diagnostic'),
    );
});

test('PI retained extension emits an authorization challenge and manual callback prompt', async () => {
    const events = [];
    const responses = [];
    const dependencies = {
        readContinuationRecord(handle) {
            assert.equal(handle, TASK_HANDLE);
            return { projectDir: '/workspace/project' };
        },
        async createModelRuntime() {
            return {
                async login(provider, method, interaction) {
                    assert.equal(provider, 'openai-codex');
                    assert.equal(method, 'oauth');
                    interaction.notify({
                        type: 'auth_url',
                        url: 'https://auth.example.test/authorize',
                    });
                    responses.push(await interaction.prompt({
                        type: 'text',
                        message: 'Paste the callback URL',
                    }));
                },
            };
        },
        createNonce: () => 'nonce-0000000001',
        emitState(state) { events.push(state); },
        waitForResponse(prompt) {
            assert.deepEqual(prompt, { ...PROMPT, type: 'manual_callback' });
            return Promise.resolve('manual-secret');
        },
    };

    const terminal = await executeRetainedLogin({
        handle: TASK_HANDLE,
        provider: 'openai-codex',
        method: 'oauth',
    }, dependencies);

    assert.deepEqual(events, [{
        status: 'waiting',
        challenge: {
            type: 'authorization_url',
            verificationUri: 'https://auth.example.test/authorize',
        },
        prompt: { ...PROMPT, type: 'manual_callback' },
    }]);
    assert.deepEqual(responses, ['manual-secret']);
    assert.equal(JSON.stringify(events).includes('manual-secret'), false);
    assert.deepEqual(terminal, { status: 'completed' });
});

test('PI retained extension emits a device-code challenge without inventing a prompt', async () => {
    const events = [];
    const terminal = await executeRetainedLogin({
        handle: TASK_HANDLE,
        provider: 'openai-codex',
        method: 'oauth',
    }, {
        readContinuationRecord: () => ({ projectDir: '/workspace/project' }),
        async createModelRuntime() {
            return {
                async login(_provider, _method, interaction) {
                    interaction.notify({
                        type: 'device_code',
                        verificationUri: 'https://auth.example.test/device',
                        userCode: 'ABCD-1234',
                    });
                },
            };
        },
        createNonce: () => 'nonce-0000000001',
        emitState(state) { events.push(state); },
        waitForResponse() { throw new Error('device flow must not invent a response prompt'); },
    });

    assert.deepEqual(events, [{
        status: 'running',
        challenge: {
            type: 'device_code',
            verificationUri: 'https://auth.example.test/device',
            userCode: 'ABCD-1234',
        },
    }]);
    assert.deepEqual(terminal, { status: 'completed' });
});

test('PI retained login sources contain no direct process, env, HOME, or secret persistence fallback', async () => {
    for (const sourceFile of [
        '../scripts/task-session-control.mjs',
        '../scripts/pi-login-protocol.mjs',
        '../extensions/ploinky-login.mjs',
    ]) {
        const source = await fs.readFile(new URL(sourceFile, import.meta.url), 'utf8');
        for (const forbidden of [
            'node:child_process',
            'process.env',
            '/root',
            'login-flow-store',
            'writeFile',
            'detached',
        ]) {
            assert.equal(source.includes(forbidden), false, `${sourceFile}: ${forbidden}`);
        }
    }
    assert.equal(controlTestables.LOGIN_EXTENSION_PATH, '/code/extensions/ploinky-login.mjs');
});
