import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { parseCodexDeviceLoginOutput } from '../scripts/codex-login-output.mjs';
import { createCodexLoginOperationSessions } from '../scripts/login-operation-sessions.mjs';
import {
    __testables as controlTestables,
} from '../scripts/task-session-control.mjs';

const HANDLE = '123e4567-e89b-42d3-a456-426614174000';
const FLOW_ID = 'login:123e4567-e89b-42d3-a456-426614174001';
const LOGIN_CONTINUATION_HANDLE = 'h'.repeat(43);
const DEVICE_URL = 'https://auth.openai.com/codex/device';
const prefix = `Welcome to Codex [v0.146.0]

Follow these steps to sign in with ChatGPT using device code authorization:

1. Open this link in your browser and sign in to your account
   ${DEVICE_URL}\u001b[0m
`;

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function operationController(completion = deferred()) {
    const controller = Object.freeze({
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        completion: completion.promise,
        launch: Object.freeze({
            helper: '/usr/local/libexec/ploinky-bwrap-launch',
            provider: 'codex',
            mode: 'operation',
            workdir: null,
            cwd: '/workspace/operation',
        }),
    });
    return { completion, controller };
}

function operationRuntime(launchFactory, {
    homePath = '/home/agent',
    runtimeKind = 'bwrap',
} = {}) {
    const calls = [];
    return {
        provider: 'codex',
        mode: 'operation',
        calls,
        resolveHomeState(resolver) {
            calls.push({ type: 'resolve' });
            return resolver({
                homePath,
                provider: 'codex',
                runtimeKind,
            });
        },
        continueOperation() {
            calls.push({ type: 'continue-operation' });
            return 'operation';
        },
        async launch(input, lifecycle) {
            calls.push({ type: 'launch', input, lifecycle });
            const controller = launchFactory({ retained: false, input, lifecycle });
            return {
                child: {
                    stdin: controller.stdin,
                    stdout: controller.stdout,
                    stderr: controller.stderr,
                },
                completion: controller.completion,
                launch: controller.launch,
            };
        },
        async launchRetainedOperation(input, lifecycle) {
            calls.push({ type: 'launch-retained', input, lifecycle });
            return launchFactory({ retained: true, input, lifecycle });
        },
    };
}

function continuationStore() {
    const record = Object.freeze({
        handle: HANDLE,
        threadId: 'thread-1',
        projectDir: '/workspace/project',
    });
    return {
        selectContinuationRecordFromHome(homePath, handle) {
            assert.equal(homePath, '/home/agent');
            assert.equal(handle, HANDLE);
            return record;
        },
    };
}

function sessionAdapter() {
    const calls = [];
    return {
        calls,
        async retainDeviceLogin(input) {
            calls.push({ operation: 'retain', input });
            return {
                type: 'login-flow',
                version: 1,
                flowId: FLOW_ID,
                continuationHandle: LOGIN_CONTINUATION_HANDLE,
                provider: 'openai',
                method: 'device_code',
                ...input.initialState,
            };
        },
        async getStatus(input) {
            calls.push({ operation: 'status', input });
            await Promise.resolve();
            return { type: 'login-flow', version: 1, status: 'running' };
        },
        respond(input) {
            calls.push({ operation: 'respond', input });
            throw Object.assign(new Error('provider login flow does not accept a response'), {
                code: 'PLOINKY_PROVIDER_LOGIN_RESPONSE_INVALID',
            });
        },
        async cancel(input) {
            calls.push({ operation: 'cancel', input });
            return { type: 'login-flow', version: 1, status: 'cancelled' };
        },
    };
}

function dependencies(overrides = {}) {
    return {
        continuationStore: continuationStore(),
        operationSessions: sessionAdapter(),
        challengeTimeoutMs: 1_000,
        ...overrides,
    };
}

test('Codex device login never treats an arbitrary URL or authorization label as the challenge', () => {
    const parsed = parseCodexDeviceLoginOutput(
        `${prefix.replace(DEVICE_URL, 'https://attacker.invalid/device')}\none-time code docs only\n`,
    );

    assert.equal(parsed.url, '');
    assert.equal(parsed.code, '');
    assert.equal(parsed.cleaned.includes('\u001b'), false);
    assert.equal(
        parseCodexDeviceLoginOutput(
            `${DEVICE_URL}.attacker.invalid\none-time code\n    ZKIH-TVK34\n`,
        ).url,
        '',
    );
    assert.equal(
        parseCodexDeviceLoginOutput(
            `\u001b]0;${DEVICE_URL}\u0007\none-time code\n    ZKIH-TVK34\n`,
        ).url,
        '',
    );
});

test('Codex device login extracts only the fixed URL and code following the one-time-code label', () => {
    const parsed = parseCodexDeviceLoginOutput(`${prefix}
2. Enter this one-time code (expires in 15 minutes)
   ZKIH-TVK34\u001b[0m
`);

    assert.equal(parsed.url, DEVICE_URL);
    assert.equal(parsed.code, 'ZKIH-TVK34');
    assert.equal(parsed.cleaned.includes('\u001b'), false);
    assert.equal(
        parseCodexDeviceLoginOutput(`${prefix}\nZKIH-TVK34\none-time code\n`).code,
        '',
    );
});

test('Codex retained device login uses the exact canonical operation and returns terminal state from completion', async () => {
    const process = operationController();
    const runtime = operationRuntime(() => process.controller);
    const deps = dependencies();
    const resultPromise = controlTestables.executeTaskSessionControlWithDependencies({
        tool: 'task-session-control',
        metadata: { invocation: { sub: 'user:test' } },
        input: {
            operation: 'login_start',
            handle: HANDLE,
            provider: 'openai',
            method: 'device_code',
        },
    }, { providerRuntime: runtime }, deps);
    process.controller.stdout.write(`${prefix}\n2. Enter this one-time code\n   ZKIH-TVK34\n`);
    const result = await resultPromise;

    assert.equal(result.ok, true);
    assert.equal(result.response.status, 'running');
    assert.equal(result.response.challenge.verificationUri, DEVICE_URL);
    assert.equal(result.response.challenge.userCode, 'ZKIH-TVK34');
    assert.deepEqual(runtime.calls.map((entry) => entry.type), [
        'resolve',
        'continue-operation',
        'launch-retained',
    ]);
    assert.deepEqual(runtime.calls[2].input, {
        command: ['/home/agent/.local/bin/codex', 'login', '--device-auth'],
    });
    assert.deepEqual(runtime.calls[2].lifecycle, {
        environment: { NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        validateAfterLease: runtime.calls[2].lifecycle.validateAfterLease,
    });
    assert.equal(typeof runtime.calls[2].lifecycle.validateAfterLease, 'function');
    runtime.calls[2].lifecycle.validateAfterLease({
        homePath: '/home/agent',
        provider: 'codex',
        runtimeKind: 'bwrap',
        mode: 'operation',
        workdir: null,
    });
    assert.equal(deps.operationSessions.calls.length, 1);
    const retained = deps.operationSessions.calls[0].input;
    assert.equal(retained.controller, process.controller);
    assert.equal(retained.authProvider, 'openai');
    assert.equal(retained.method, 'device_code');
    assert.deepEqual(retained.initialState.challenge, {
        type: 'device_code',
        verificationUri: DEVICE_URL,
        userCode: 'ZKIH-TVK34',
    });
    process.completion.resolve({ code: 0, signal: null });
    assert.deepEqual(await retained.onCompletion({ outcome: { code: 0, signal: null } }), {
        status: 'completed',
    });
    assert.deepEqual(await retained.onCompletion({ outcome: { code: 1, signal: null } }), {
        status: 'failed',
        error: 'provider_login_failed',
    });
});

test('Codex device challenge collection is bounded and never publishes attacker-controlled URLs', async () => {
    const process = operationController();
    const runtime = operationRuntime(() => process.controller);
    const resultPromise = controlTestables.executeTaskSessionControlWithDependencies({
        input: {
            operation: 'login_start',
            handle: HANDLE,
            provider: 'openai',
            method: 'device_code',
        },
    }, { providerRuntime: runtime }, dependencies());
    process.controller.stderr.write('x'.repeat(controlTestables.OUTPUT_LIMIT + 1));

    await assert.rejects(resultPromise, (error) => {
        assert.equal(error?.code, 'PLOINKY_CODEX_LOGIN_FAILED');
        assert.doesNotMatch(error.message, /x{32}/u);
        return true;
    });
});

test('Codex retained login rejects every non-canonical container HOME before provider launch', async () => {
    const runtime = operationRuntime(() => {
        throw new Error('provider launch must not run');
    }, {
        homePath: '/tmp/attacker-home',
        runtimeKind: 'container',
    });
    await assert.rejects(
        controlTestables.executeTaskSessionControlWithDependencies({
            input: {
                operation: 'login_describe',
                handle: HANDLE,
            },
        }, { providerRuntime: runtime }, dependencies({
            continuationStore: {
                selectContinuationRecordFromHome() {
                    throw new Error('continuation state must not be inspected');
                },
            },
        })),
        { code: 'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID' },
    );
    assert.deepEqual(runtime.calls.map((entry) => entry.type), ['resolve']);
});

test('Codex one-shot secret login passes the secret only over canonical stdin and never echoes it', async () => {
    const secret = 'secret-canary-value';
    let stdin = '';
    const runtime = operationRuntime(() => {
        const process = operationController();
        process.controller.stdin.setEncoding('utf8');
        process.controller.stdin.on('data', (chunk) => { stdin += chunk; });
        process.controller.stdin.on('end', () => {
            process.controller.stderr.end(`provider rejected ${secret}`);
            process.completion.resolve({ code: 1, signal: null });
        });
        return process.controller;
    });

    await assert.rejects(
        controlTestables.executeTaskSessionControlWithDependencies({
            input: {
                operation: 'login_start',
                handle: HANDLE,
                provider: 'openai',
                method: 'api_key',
                apiKey: secret,
            },
        }, { providerRuntime: runtime }, dependencies()),
        (error) => {
            assert.equal(error?.code, 'PLOINKY_CODEX_LOGIN_FAILED');
            assert.doesNotMatch(error.message, new RegExp(secret));
            return true;
        },
    );
    assert.equal(stdin, `${secret}\n`);
    assert.equal(JSON.stringify(runtime.calls).includes(secret), false);
    assert.deepEqual(runtime.calls.at(-1).input, {
        command: ['/home/agent/.local/bin/codex', 'login', '--with-api-key'],
    });
});

test('Codex catalog uses a canonical operation while retained-flow controls use only the session registry', async () => {
    const runtime = operationRuntime(() => {
        const process = operationController();
        setImmediate(() => process.completion.resolve({ code: 0, signal: null }));
        return process.controller;
    });
    const deps = dependencies();
    const described = await controlTestables.executeTaskSessionControlWithDependencies({
        input: { operation: 'login_describe', handle: HANDLE },
    }, { providerRuntime: runtime }, deps);
    assert.equal(described.ok, true);
    assert.deepEqual(described.response.providers, controlTestables.PROVIDERS);
    assert.equal(runtime.calls.at(-1).type, 'launch');

    const beforeControls = runtime.calls.length;
    const status = await controlTestables.executeTaskSessionControlWithDependencies({
        input: {
            operation: 'login_status',
            flowId: FLOW_ID,
            continuationHandle: LOGIN_CONTINUATION_HANDLE,
        },
    }, { providerRuntime: runtime }, deps);
    assert.equal(status.response.status, 'running');
    assert.equal(runtime.calls.length, beforeControls);
    assert.deepEqual(deps.operationSessions.calls.at(-1).input, {
        flowId: FLOW_ID,
        continuationHandle: LOGIN_CONTINUATION_HANDLE,
    });

    await assert.rejects(
        controlTestables.executeTaskSessionControlWithDependencies({
            input: {
                operation: 'login_respond',
                flowId: FLOW_ID,
                continuationHandle: LOGIN_CONTINUATION_HANDLE,
                seq: 1,
                nonce: 'nonce_nonce_nonce_1',
                response: 'must-not-be-accepted',
            },
        }, { providerRuntime: runtime }, deps),
        { code: 'PLOINKY_PROVIDER_LOGIN_RESPONSE_INVALID' },
    );
    assert.equal(runtime.calls.length, beforeControls);

    const cancelled = await controlTestables.executeTaskSessionControlWithDependencies({
        input: {
            operation: 'login_cancel',
            flowId: FLOW_ID,
            continuationHandle: LOGIN_CONTINUATION_HANDLE,
        },
    }, { providerRuntime: runtime }, deps);
    assert.equal(cancelled.response.status, 'cancelled');
    assert.equal(runtime.calls.length, beforeControls);
});

test('Codex session adapter forwards the exact shared retained-flow contract', async () => {
    const calls = [];
    const shared = {
        retainLoginOperation(input) {
            calls.push(['retain', input]);
            return { status: 'running' };
        },
        getLoginStatus(control) {
            calls.push(['status', control]);
            return { status: 'running' };
        },
        async respondToLogin(control, response) {
            calls.push(['respond', control, response]);
            throw Object.assign(new Error('not waiting'), {
                code: 'PLOINKY_PROVIDER_LOGIN_RESPONSE_INVALID',
            });
        },
        cancelLogin(control) {
            calls.push(['cancel', control]);
            return { status: 'cancelled' };
        },
    };
    const adapter = createCodexLoginOperationSessions(shared);
    const control = {
        flowId: FLOW_ID,
        continuationHandle: LOGIN_CONTINUATION_HANDLE,
    };
    const controller = operationController().controller;
    await adapter.retainDeviceLogin({
        controller,
        authProvider: 'openai',
        method: 'device_code',
        initialState: { status: 'running' },
    });
    adapter.getStatus(control);
    await assert.rejects(
        () => adapter.respond({
            ...control,
            seq: 1,
            nonce: 'nonce_nonce_nonce_1',
            response: 'not-accepted',
        }),
        { code: 'PLOINKY_PROVIDER_LOGIN_RESPONSE_INVALID' },
    );
    await adapter.cancel(control);

    assert.equal(calls[0][0], 'retain');
    assert.equal(Object.hasOwn(calls[0][1], 'owner'), false);
    assert.deepEqual(calls[1], ['status', control]);
    assert.deepEqual(calls[2], [
        'respond',
        control,
        { seq: 1, nonce: 'nonce_nonce_nonce_1', response: 'not-accepted' },
    ]);
    assert.deepEqual(calls[3], ['cancel', control]);
});

test('Codex control config uses only providerExecution and legacy detached state files are absent', async () => {
    const config = JSON.parse(await fs.readFile(new URL('../mcp-config.json', import.meta.url), 'utf8'));
    const tool = config.tools.find((entry) => entry.name === 'task-session-control');
    assert.deepEqual(tool.providerExecution, {
        provider: 'codex',
        mode: 'operation',
        module: '/code/scripts/task-session-control.mjs',
        export: 'executeTaskSessionControl',
    });
    for (const field of ['command', 'args', 'cwd', 'env']) assert.equal(field in tool, false, field);
    assert.equal(tool.inputSchema.handle.optional, true);
    assert.equal(tool.inputSchema.continuationHandle.type, 'string');
    assert.equal(tool.inputSchema.seq.type, 'number');
    assert.equal(tool.inputSchema.nonce.type, 'string');

    for (const sourceFile of [
        '../scripts/task-session-control.mjs',
        '../scripts/codex-login-output.mjs',
        '../scripts/login-operation-sessions.mjs',
    ]) {
        const source = await fs.readFile(new URL(sourceFile, import.meta.url), 'utf8');
        for (const forbidden of [
            'node:child_process',
            'login-flow-store',
            'codex-login-worker',
            'process.env',
            'detached',
        ]) {
            assert.equal(source.includes(forbidden), false, `${sourceFile}: ${forbidden}`);
        }
    }
    const controlSource = await fs.readFile(
        new URL('../scripts/task-session-control.mjs', import.meta.url),
        'utf8',
    );
    assert.match(controlSource, /context\.runtimeKind === 'container'[\s\S]*context\.homePath === '\/root'/u);
    for (const legacyFile of [
        '../scripts/login-flow-store.mjs',
        '../scripts/codex-login-worker.mjs',
    ]) {
        await assert.rejects(fs.access(new URL(legacyFile, import.meta.url)), undefined, legacyFile);
    }
});
