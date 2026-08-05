import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import {
    parseOpenCodeDeviceLoginOutput,
} from '../scripts/opencode-login-output.mjs';
import {
    createOpenCodeLoginOperationSessions,
} from '../scripts/login-operation-sessions.mjs';
import {
    __testables as controlTestables,
} from '../scripts/task-session-control.mjs';

const HANDLE = '123e4567-e89b-42d3-a456-426614174000';
const FLOW_ID = 'login:123e4567-e89b-42d3-a456-426614174001';
const LOGIN_CONTINUATION_HANDLE = 'h'.repeat(43);

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
            provider: 'opencode',
            mode: 'operation',
            workdir: null,
            cwd: '/workspace/operation',
        }),
    });
    return { completion, controller };
}

function operationRuntime(launchFactory) {
    const calls = [];
    return {
        provider: 'opencode',
        mode: 'operation',
        calls,
        resolveHomeState(resolver) {
            calls.push({ type: 'resolve' });
            return resolver({
                homePath: '/home/agent',
                provider: 'opencode',
                runtimeKind: 'bwrap',
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
        version: 1,
        provider: 'opencode',
        projectDir: '/workspace/project',
        sessionId: 'ses-1',
        createdAt: '2026-08-05T00:00:00.000Z',
        updatedAt: '2026-08-05T00:01:00.000Z',
    });
    return {
        continuationStoreForHome(homePath) {
            assert.equal(homePath, '/home/agent');
            return {
                readContinuationRecord(handle) {
                    assert.equal(handle, HANDLE);
                    return record;
                },
            };
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
                provider: input.authProvider,
                method: input.method,
                ...input.initialState,
            };
        },
        async getStatus(input) {
            calls.push({ operation: 'status', input });
            return { type: 'login-flow', version: 1, status: 'running' };
        },
        async respond(input) {
            calls.push({ operation: 'respond', input });
            throw Object.assign(new Error('not waiting'), {
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

test('OpenCode device challenge parser accepts only the pinned provider URL and labeled code', () => {
    const github = parseOpenCodeDeviceLoginOutput(`
        \u001b[31mGo to: https://github.com/login/device\u001b[0m
        Enter code: D47B-97EF
    `, 'https://github.com/login/device');
    assert.equal(github.url, 'https://github.com/login/device');
    assert.equal(github.code, 'D47B-97EF');
    assert.equal(github.cleaned.includes('\u001b'), false);

    assert.deepEqual(
        parseOpenCodeDeviceLoginOutput(
            'Go to: https://github.com/login/device.attacker.invalid\nEnter code: D47B-97EF',
            'https://github.com/login/device',
        ),
        {
            cleaned: 'Go to: https://github.com/login/device.attacker.invalid\nEnter code: D47B-97EF',
            url: '',
            code: '',
        },
    );
    assert.equal(
        parseOpenCodeDeviceLoginOutput(
            'D47B-97EF\nGo to: https://github.com/login/device\n',
            'https://github.com/login/device',
        ).code,
        '',
    );
    assert.deepEqual(
        parseOpenCodeDeviceLoginOutput(
            '┌  Add credential\n│\n●  Go to: https://auth.openai.com/codex/device\n'
                + '│\n●  Enter code: AQLC-REIIA\n│\n◒  Waiting for authorization',
            'https://auth.openai.com/codex/device',
        ),
        {
            cleaned: '┌  Add credential\n│\n●  Go to: https://auth.openai.com/codex/device\n'
                + '│\n●  Enter code: AQLC-REIIA\n│\n◒  Waiting for authorization',
            url: 'https://auth.openai.com/codex/device',
            code: 'AQLC-REIIA',
        },
    );
});

test('OpenCode retained OAuth uses only canonical stdio and returns terminal state from completion', async () => {
    const process = operationController();
    const runtime = operationRuntime(() => process.controller);
    const deps = dependencies();
    let stdin = Buffer.alloc(0);
    process.controller.stdin.on('data', (chunk) => { stdin = Buffer.concat([stdin, chunk]); });

    const resultPromise = controlTestables.executeTaskSessionControlWithDependencies({
        input: {
            operation: 'login_start',
            handle: HANDLE,
            provider: 'github-copilot',
            method: 'oauth:0',
            inputs: { deploymentType: 'github.com' },
        },
    }, { providerRuntime: runtime }, deps);
    process.controller.stdout.write('\u001b[?25lSelect GitHub deployment type');
    await new Promise((resolve) => setImmediate(resolve));
    process.controller.stdout.write('\nGo to: https://github.com/login/device\nEnter code: D47B-97EF\n');
    const result = await resultPromise;

    assert.equal(result.ok, true);
    assert.equal(result.response.status, 'running');
    assert.deepEqual(result.response.challenge, {
        type: 'device_code',
        verificationUri: 'https://github.com/login/device',
        userCode: 'D47B-97EF',
    });
    assert.deepEqual(runtime.calls.map((entry) => entry.type), [
        'resolve',
        'continue-operation',
        'launch-retained',
    ]);
    assert.deepEqual(runtime.calls[2].input, {
        command: [
            '/home/agent/.opencode/bin/opencode',
            'auth',
            'login',
            '--pure',
            '-p',
            'github-copilot',
            '-m',
            'Login with GitHub Copilot',
        ],
    });
    assert.deepEqual(runtime.calls[2].lifecycle, {
        environment: { NO_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
        validateAfterLease: runtime.calls[2].lifecycle.validateAfterLease,
    });
    assert.equal(stdin.equals(Buffer.from([13])), true);
    assert.equal(deps.operationSessions.calls.length, 1);
    const retained = deps.operationSessions.calls[0].input;
    assert.equal(retained.controller, process.controller);
    assert.equal(retained.authProvider, 'github-copilot');
    assert.equal(retained.method, 'oauth:0');
    assert.equal(retained.onStatus, undefined);
    assert.equal(retained.onRespond, undefined);
    process.controller.stdout.write('\nLogin successful\n');
    process.controller.stdout.write('spinner'.repeat(6_000));
    process.controller.stdout.write('\nLogin successful\n');
    process.completion.resolve({ code: 0, signal: null });
    assert.deepEqual(await retained.onCompletion({ outcome: { code: 0, signal: null } }), {
        status: 'completed',
    });
    assert.deepEqual(await retained.onCompletion({ outcome: { code: 1, signal: null } }), {
        status: 'failed',
        error: 'provider_login_failed',
    });
});

test('OpenCode enterprise OAuth derives a strict HTTPS challenge origin before launch', () => {
    const selection = controlTestables.activePrompts({
        prompts: [{
            type: 'select',
            key: 'deploymentType',
            options: [{ value: 'github.com' }, { value: 'enterprise' }],
        }, {
            type: 'text',
            key: 'enterpriseUrl',
            when: { key: 'deploymentType', op: 'eq', value: 'enterprise' },
        }],
    }, {
        deploymentType: 'enterprise',
        enterpriseUrl: 'https://company.ghe.example:8443',
    });
    assert.equal(controlTestables.deviceVerificationUri({
        verificationUri: 'https://github.com/login/device',
    }, selection), 'https://company.ghe.example:8443/login/device');
    assert.throws(() => controlTestables.deviceVerificationUri({
        verificationUri: 'https://github.com/login/device',
    }, controlTestables.activePrompts({
        prompts: [{
            type: 'select',
            key: 'deploymentType',
            options: [{ value: 'github.com' }, { value: 'enterprise' }],
        }, {
            type: 'text',
            key: 'enterpriseUrl',
            when: { key: 'deploymentType', op: 'eq', value: 'enterprise' },
        }],
    }, {
        deploymentType: 'enterprise',
        enterpriseUrl: 'https://user:password@company.ghe.example/path',
    })), /enterprise URL is invalid/u);
});

test('OpenCode API-key login sends secrets only through canonical stdin', async () => {
    const secret = 'provider-secret-canary';
    let stdin = '';
    const runtime = operationRuntime(() => {
        const process = operationController();
        process.controller.stdin.setEncoding('utf8');
        process.controller.stdin.on('data', (chunk) => {
            stdin += chunk;
            if (stdin.includes(secret)) {
                process.controller.stdout.end('└  Done\n');
                process.completion.resolve({ code: 0, signal: null });
            }
        });
        setImmediate(() => process.controller.stdout.write('Enter your API key'));
        return process.controller;
    });

    const result = await controlTestables.executeTaskSessionControlWithDependencies({
        input: {
            operation: 'login_start',
            handle: HANDLE,
            provider: 'openai',
            method: 'api_key:2',
            apiKey: secret,
        },
    }, { providerRuntime: runtime }, dependencies());

    assert.equal(result.response.status, 'completed');
    assert.equal(stdin, `${secret}\r`);
    assert.equal(JSON.stringify(runtime.calls).includes(secret), false);
    assert.equal(runtime.calls.at(-1).input.command.includes('serve'), false);
});

test('OpenCode credential-form values stay on stdin and follow pinned prompt order', async () => {
    const token = 'glpat-provider-token-canary';
    const apiKey = 'generic-provider-key-canary';
    let stdin = '';
    const runtime = operationRuntime(() => {
        const process = operationController();
        process.controller.stdin.setEncoding('utf8');
        process.controller.stdin.on('data', (chunk) => {
            stdin += chunk;
            if (stdin === `${token}\r`) {
                process.controller.stdout.write('Enter your API key');
            }
            if (stdin === `${token}\r${apiKey}\r`) {
                process.controller.stdout.end('Login successful\n');
                process.completion.resolve({ code: 0, signal: null });
            }
        });
        setImmediate(() => process.controller.stdout.write('Personal Access Token'));
        return process.controller;
    });

    const result = await controlTestables.executeTaskSessionControlWithDependencies({
        input: {
            operation: 'login_start',
            handle: HANDLE,
            provider: 'gitlab',
            method: 'api_key:1',
            apiKey,
            inputs: { token },
        },
    }, { providerRuntime: runtime }, dependencies());

    assert.equal(result.response.status, 'completed');
    assert.equal(stdin, `${token}\r${apiKey}\r`);
    const serializedCalls = JSON.stringify(runtime.calls);
    assert.equal(serializedCalls.includes(token), false);
    assert.equal(serializedCalls.includes(apiKey), false);
});

test('OpenCode catalog probes the pinned CLI while retained controls use only AgentServer sessions', async () => {
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
    assert.equal(described.response.type, 'login-catalog');
    assert.equal(
        described.response.providers.find((provider) => provider.key === 'openai')
            .methods.find((method) => method.key === 'oauth:1').kind,
        'device_code',
    );
    assert.deepEqual(
        described.response.providers.map((provider) => provider.key),
        [
            'openai',
            'github-copilot',
            'gitlab',
            'poe',
            'cloudflare-workers-ai',
            'cloudflare-ai-gateway',
        ],
    );
    assert.equal(JSON.stringify(described.response).includes('verificationUri'), false);
    assert.equal(Object.isFrozen(described.response.providers), true);
    assert.equal(
        described.response.providers.find((provider) => provider.key === 'gitlab')
            .methods[0].prompts[0].type,
        'secret',
    );
    assert.deepEqual(runtime.calls.at(-1).input.command, [
        '/home/agent/.opencode/bin/opencode',
        'auth',
        'login',
        '--help',
    ]);

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

    await assert.rejects(controlTestables.executeTaskSessionControlWithDependencies({
        input: {
            operation: 'login_respond',
            flowId: FLOW_ID,
            continuationHandle: LOGIN_CONTINUATION_HANDLE,
            seq: 1,
            nonce: 'nonce_nonce_nonce_1',
            response: 'not-accepted',
        },
    }, { providerRuntime: runtime }, deps), {
        code: 'PLOINKY_PROVIDER_LOGIN_RESPONSE_INVALID',
    });
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

test('OpenCode session adapter forwards exact continuation capabilities and prompt binding', async () => {
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
        respondToLogin(control, response) {
            calls.push(['respond', control, response]);
            return { status: 'running' };
        },
        cancelLogin(control) {
            calls.push(['cancel', control]);
            return { status: 'cancelled' };
        },
    };
    const adapter = createOpenCodeLoginOperationSessions(shared);
    const control = { flowId: FLOW_ID, continuationHandle: LOGIN_CONTINUATION_HANDLE };
    await adapter.retainDeviceLogin({ controller: operationController().controller });
    await adapter.getStatus(control);
    await adapter.respond({
        ...control,
        seq: 1,
        nonce: 'nonce_nonce_nonce_1',
        response: 'secret response',
    });
    await adapter.cancel(control);

    assert.deepEqual(calls[1], ['status', control]);
    assert.deepEqual(calls[2], [
        'respond',
        control,
        { seq: 1, nonce: 'nonce_nonce_nonce_1', response: 'secret response' },
    ]);
    assert.deepEqual(calls[3], ['cancel', control]);
});

test('OpenCode login rejects extra legacy fields, oversized responses, and unknown prompt inputs', async () => {
    const runtime = operationRuntime(() => operationController().controller);
    const deps = dependencies();
    await assert.rejects(controlTestables.executeTaskSessionControlWithDependencies({
        input: {
            operation: 'login_status',
            flowId: FLOW_ID,
            continuationHandle: LOGIN_CONTINUATION_HANDLE,
            handle: HANDLE,
        },
    }, { providerRuntime: runtime }, deps), /unsupported field/u);
    await assert.rejects(controlTestables.executeTaskSessionControlWithDependencies({
        input: {
            operation: 'login_respond',
            flowId: FLOW_ID,
            continuationHandle: LOGIN_CONTINUATION_HANDLE,
            seq: 1,
            nonce: 'nonce_nonce_nonce_1',
            response: 'x'.repeat(8193),
        },
    }, { providerRuntime: runtime }, deps), /response is invalid/u);
    await assert.rejects(controlTestables.executeTaskSessionControlWithDependencies({
        input: {
            operation: 'login_start',
            handle: HANDLE,
            provider: 'github-copilot',
            method: 'oauth:0',
            inputs: { deploymentType: 'github.com', unexpected: 'value' },
        },
    }, { providerRuntime: runtime }, deps), /prompt input/u);
    await assert.rejects(controlTestables.executeTaskSessionControlWithDependencies({
        input: {
            operation: 'login_start',
            handle: HANDLE,
            provider: 'gitlab',
            method: 'api_key:1',
            apiKey: 'provider-key',
            inputs: { token: 'Enter your API key\rspoof' },
        },
    }, { providerRuntime: runtime }, deps), /prompt input/u);
});
