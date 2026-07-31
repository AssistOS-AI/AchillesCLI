import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
    createSoulGatewayInvoker,
    SOUL_GATEWAY_PROVIDER_KEY,
} from '../src/lib/soulGatewayInvoker.mjs';

test('Soul Gateway invoker passes an opaque agent-backed model through the gateway', async () => {
    let captured = null;
    const baseInvoker = async (invocation) => {
        captured = invocation;
        return { output: 'ok' };
    };

    const invoker = createSoulGatewayInvoker(baseInvoker);
    const model = 'AchillesCLI/opencodeAgent/soul-gateway/fast';
    const result = await invoker({
        prompt: 'Use the selected model.',
        history: [{ role: 'user', message: 'Previous turn' }],
        model,
        providerKey: 'untrusted_override',
    });

    assert.equal(result.output, 'ok');
    assert.equal(captured.model, model);
    assert.equal(captured.prompt, 'Use the selected model.');
    assert.deepEqual(captured.history, [{ role: 'user', message: 'Previous turn' }]);
    assert.equal(captured.providerKey, SOUL_GATEWAY_PROVIDER_KEY);
});

test('Soul Gateway invoker rejects a missing base invoker', () => {
    assert.throws(
        () => createSoulGatewayInvoker(),
        /requires an invoker function/,
    );
});

test('Soul Gateway invoker preserves the standard invoker introspection contract', async () => {
    const calls = [];
    const baseInvoker = async (invocation) => {
        calls.push(invocation);
        return { output: 'ok' };
    };
    baseInvoker.getSupportedModels = () => ['fast'];
    baseInvoker.listAvailableModels = () => ({ models: [{ name: 'fast' }] });
    baseInvoker.getLastInvocationDetails = () => ({ model: 'fast' });
    baseInvoker.describe = () => ({ configPath: '/config' });

    const invoker = createSoulGatewayInvoker(baseInvoker);

    await invoker({ prompt: 'hello', model: 'fast' });
    assert.equal(calls[0].providerKey, SOUL_GATEWAY_PROVIDER_KEY);
    assert.deepEqual(invoker.getSupportedModels(), ['fast']);
    assert.deepEqual(invoker.listAvailableModels(), { models: [{ name: 'fast' }] });
    assert.deepEqual(invoker.getLastInvocationDetails(), { model: 'fast' });
    assert.deepEqual(invoker.describe(), { configPath: '/config' });
});

test('generated-local invoker relies on the branded AgentLib provider and rejects protected overrides', async () => {
    const descriptor = Object.freeze({ envelopeDigest: 'sha256:test' });
    const calls = [];
    const baseInvoker = async (invocation) => {
        calls.push(invocation);
        return { output: 'ok' };
    };
    const invoker = createSoulGatewayInvoker(baseInvoker, {
        generatedLocalDescriptor: descriptor,
        isVerifiedGeneratedLocalRouterDescriptor: (candidate) => candidate === descriptor,
    });

    await invoker({ prompt: 'hello', model: 'fast' });
    assert.deepEqual(calls, [{ prompt: 'hello', model: 'soul_gateway/fast' }]);
    assert.equal(Object.hasOwn(calls[0], 'providerKey'), false);

    for (const protectedName of [
        'providerKey',
        'baseURL',
        'apiKey',
        'apiKeyEnv',
        'headers',
        'transport',
    ]) {
        assert.throws(
            () => invoker({ prompt: 'hello', [protectedName]: 'override' }),
            (error) => error?.code === 'PLOINKY_GENERATED_LOCAL_OVERRIDE',
        );
    }
    assert.equal(calls.length, 1);
});

test('generated-local invoker rejects URL-shaped and otherwise unbranded descriptor injection', () => {
    const baseInvoker = async () => ({ output: 'unexpected' });
    assert.throws(
        () => createSoulGatewayInvoker(baseInvoker, {
            generatedLocalDescriptor: { physicalOrigin: 'http://127.0.0.1:8080' },
            isVerifiedGeneratedLocalRouterDescriptor: () => false,
        }),
        /unverified generated-local descriptors/,
    );
});

test('real AgentLib composition routes an uncatalogued opaque model and preserves its wire id', () => {
    const workspaceRoot = path.resolve(import.meta.dirname, '../..', '..');
    const fixtureRoot = path.join(workspaceRoot, 'ploinky', 'tests', 'fixtures', 'router-descriptor');
    const agentLibRoot = path.join(workspaceRoot, 'ploinky', 'node_modules', 'achillesAgentLib');
    const fixtureEnv = JSON.parse(fs.readFileSync(
        path.join(fixtureRoot, 'public-environment.json'),
        'utf8',
    ));
    fixtureEnv.PLOINKY_ROUTER_DESCRIPTOR_FILE = path.join(fixtureRoot, 'public-envelope.json');
    fixtureEnv.ACHILLES_ENV_START_DIR = '/';

    const invokerModuleUrl = pathToFileURL(path.resolve(
        import.meta.dirname,
        '../src/lib/soulGatewayInvoker.mjs',
    )).href;
    const descriptorModuleUrl = pathToFileURL(path.join(
        agentLibRoot,
        'utils/LLMProviders/transport/generatedLocalRouterDescriptor.mjs',
    )).href;
    const transportModuleUrl = pathToFileURL(path.join(
        agentLibRoot,
        'utils/LLMProviders/transport/routerHttpTransport.mjs',
    )).href;
    const llmClientModuleUrl = pathToFileURL(path.join(agentLibRoot, 'utils/LLMClient.mjs')).href;
    const opaqueModel = 'AchillesCLI/opencodeAgent/soul-gateway/opaque-uncatalogued';

    const childSource = `
        import assert from 'node:assert/strict';
        import http from 'node:http';
        import { once } from 'node:events';

        const opaqueModel = ${JSON.stringify(opaqueModel)};
        const requests = [];
        let wireBody = null;
        const server = http.createServer(async (request, response) => {
            const chunks = [];
            for await (const chunk of request) chunks.push(chunk);
            const rawBody = Buffer.concat(chunks).toString('utf8');
            requests.push({ method: request.method, path: request.url });
            response.writeHead(200, { 'content-type': 'application/json' });
            if (request.method === 'GET') {
                response.end(JSON.stringify({ data: [{ id: 'catalogued-but-not-selected' }] }));
                return;
            }
            wireBody = JSON.parse(rawBody);
            response.end(JSON.stringify({ choices: [{ message: { content: 'opaque-ok' } }] }));
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const port = server.address().port;

        const transport = await import(${JSON.stringify(transportModuleUrl)});
        let socketFactoryCalls = 0;
        transport.__setRouterRequestFactoryForTests((_protocol, options, callback) => {
            socketFactoryCalls += 1;
            return http.request({ ...options, hostname: '127.0.0.1', port }, callback);
        });
        const llm = await import(${JSON.stringify(llmClientModuleUrl)});
        const descriptorApi = await import(${JSON.stringify(descriptorModuleUrl)});
        const cli = await import(${JSON.stringify(invokerModuleUrl)});
        const descriptor = descriptorApi.loadGeneratedLocalRouterDescriptor({ env: process.env });
        assert.equal(descriptorApi.isVerifiedGeneratedLocalRouterDescriptor(descriptor), true);

        const originalEnv = process.env;
        let invocationKeyReads = 0;
        process.env = new Proxy(originalEnv, {
            get(target, property, receiver) {
                if (property === 'PLOINKY_AGENT_API_KEY') invocationKeyReads += 1;
                return Reflect.get(target, property, receiver);
            },
        });
        try {
            const invoker = cli.createSoulGatewayInvoker(llm.defaultLLMInvokerStrategy, {
                generatedLocalDescriptor: descriptor,
                isVerifiedGeneratedLocalRouterDescriptor: descriptorApi.isVerifiedGeneratedLocalRouterDescriptor,
            });
            const output = await invoker({ prompt: 'use opaque', model: opaqueModel });
            assert.equal(output.output, 'opaque-ok');
            const countersBeforeOverride = { invocationKeyReads, socketFactoryCalls };
            assert.throws(
                () => invoker({ prompt: 'blocked', model: opaqueModel, baseURL: 'https://override.invalid' }),
                (error) => error?.code === 'PLOINKY_GENERATED_LOCAL_OVERRIDE',
            );
            assert.deepEqual(
                { invocationKeyReads, socketFactoryCalls },
                countersBeforeOverride,
            );
        } finally {
            process.env = originalEnv;
            transport.__resetRouterRequestFactoryForTests();
            server.close();
            await once(server, 'close');
        }
        process.stdout.write('RESULT:' + JSON.stringify({
            requests,
            wireModel: wireBody?.model,
            invocationKeyReads,
            socketFactoryCalls,
        }));
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', childSource], {
        cwd: workspaceRoot,
        env: fixtureEnv,
        encoding: 'utf8',
        timeout: 10_000,
    });

    assert.equal(child.status, 0, child.stderr || child.stdout);
    const marker = child.stdout.lastIndexOf('RESULT:');
    assert.notEqual(marker, -1, child.stdout);
    const result = JSON.parse(child.stdout.slice(marker + 'RESULT:'.length));
    assert.deepEqual(result.requests, [
        { method: 'GET', path: '/base-agent-additional-server/soul-gateway/7000/v1/models' },
        { method: 'POST', path: '/base-agent-additional-server/soul-gateway/7000/v1/chat/completions' },
    ]);
    assert.equal(result.wireModel, opaqueModel);
    assert.equal(result.invocationKeyReads, 1);
    assert.equal(result.socketFactoryCalls, 2);
});
