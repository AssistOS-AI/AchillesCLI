import test from 'node:test';
import assert from 'node:assert/strict';

import {
    clearSoulGatewayModelCache,
    formatSoulGatewayModelDescription,
    loadSoulGatewayModels,
    normalizeSoulGatewayModelCatalog,
    resolveSoulGatewayModelsUrl,
} from '../src/lib/soulGatewayModels.mjs';

const GENERATED_MODELS_PATH = '/base-agent-additional-server/soul-gateway/7000/v1/models';

function externalOnlyApi() {
    return {
        GENERATED_LOCAL_MODELS_PATH: GENERATED_MODELS_PATH,
        loadGeneratedLocalRouterDescriptor() {
            return null;
        },
        refreshGeneratedLocalRouterDescriptor() {
            throw new Error('descriptor refresh must not run for an external provider');
        },
        buildGeneratedLocalOperationURL() {
            throw new Error('generated-local URL construction must not run for an external provider');
        },
        routerHttpRequest() {
            throw new Error('generated-local transport must not run for an external provider');
        },
    };
}

test('explicit external Soul Gateway URL remains supported without Router fallback', () => {
    const url = resolveSoulGatewayModelsUrl({
        SOUL_GATEWAY_BASE_URL: 'https://external.invalid/v1',
    });
    assert.equal(url.href, 'https://external.invalid/v1/models');
    assert.throws(
        () => resolveSoulGatewayModelsUrl({ PLOINKY_ROUTER_URL: 'http://router.invalid:8080' }),
        /SOUL_GATEWAY_BASE_URL is not set/,
    );
});

test('model catalog removes aliases, deduplicates names, and prioritizes recommendations', () => {
    const models = normalizeSoulGatewayModelCatalog({
        data: [
            { id: 'provider/large', owned_by: 'provider', _tags: ['chat'] },
            { id: 'deep', owned_by: 'soul-gateway', _strategy: 'cascade', _child_count: 2 },
            { id: 'fast', owned_by: 'soul-gateway', _strategy: 'cascade', _child_count: 3 },
            { id: 'fast', owned_by: 'duplicate' },
            { id: 'large', _alias: true, root: 'provider/large' },
        ],
    }, { selectedModel: 'provider/large' });

    assert.deepEqual(models.map((model) => model.name), ['provider/large', 'fast', 'deep']);
    assert.equal(formatSoulGatewayModelDescription(models[1]), 'soul-gateway · Cascade · 3 models');
});

test('Soul Gateway models are fetched with the agent identity and cached', async () => {
    clearSoulGatewayModelCache();
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url: url.href, options });
        return {
            ok: true,
            async json() {
                return { data: [{ id: 'fast', owned_by: 'soul-gateway', _strategy: 'cascade' }] };
            },
        };
    };
    const options = {
        env: {
            SOUL_GATEWAY_BASE_URL: 'https://gateway.example/v1',
            SOUL_GATEWAY_API_KEY: 'external-test-key',
        },
        fetchImpl,
        generatedLocalApi: externalOnlyApi(),
    };

    const first = await loadSoulGatewayModels(options);
    const second = await loadSoulGatewayModels(options);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://gateway.example/v1/models');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer external-test-key');
    assert.equal(first[0].name, 'fast');
    assert.equal(second[0].name, 'fast');
    clearSoulGatewayModelCache();
});

test('generated-local discovery validates descriptor and exact operation before key read or transport', async () => {
    clearSoulGatewayModelCache();
    const descriptor = Object.freeze({ envelopeDigest: 'sha256:test' });
    const order = [];
    const env = new Proxy({
        PLOINKY_ROUTER_DESCRIPTOR_FILE: '/run/ploinky/router-descriptor.json',
        PLOINKY_AGENT_API_KEY: 'agent:test/key',
    }, {
        get(target, name) {
            if (name === 'PLOINKY_AGENT_API_KEY') {
                assert.deepEqual(order, ['load', 'refresh', 'operation']);
                order.push('key');
            }
            return target[name];
        },
    });
    const generatedLocalApi = {
        GENERATED_LOCAL_MODELS_PATH: GENERATED_MODELS_PATH,
        loadGeneratedLocalRouterDescriptor({ env: actualEnv }) {
            assert.equal(actualEnv, env);
            order.push('load');
            return descriptor;
        },
        refreshGeneratedLocalRouterDescriptor(actualDescriptor, { env: actualEnv }) {
            assert.equal(actualDescriptor, descriptor);
            assert.equal(actualEnv, env);
            order.push('refresh');
            return descriptor;
        },
        buildGeneratedLocalOperationURL(actualDescriptor, pathname) {
            assert.equal(actualDescriptor, descriptor);
            assert.equal(pathname, GENERATED_MODELS_PATH);
            order.push('operation');
            return new URL(`http://host.containers.internal:8080${pathname}`);
        },
        async routerHttpRequest(options) {
            order.push('transport');
            assert.equal(options.descriptor, descriptor);
            assert.equal(options.pathname, GENERATED_MODELS_PATH);
            assert.equal(options.bearer, 'agent:test/key');
            return {
                ok: true,
                async json() {
                    return { data: [{ id: 'fast', owned_by: 'soul-gateway' }] };
                },
            };
        },
    };
    let fetchCalls = 0;

    const models = await loadSoulGatewayModels({
        env,
        generatedLocalApi,
        fetchImpl: async () => {
            fetchCalls += 1;
            throw new Error('native fetch must not run for generated-local discovery');
        },
        forceRefresh: true,
    });

    assert.deepEqual(order, ['load', 'refresh', 'operation', 'key', 'transport']);
    assert.equal(fetchCalls, 0);
    assert.equal(models[0].name, 'fast');
    clearSoulGatewayModelCache();
});

test('partial generated-local startup failure cannot fall through to external fetch or key reads', async () => {
    clearSoulGatewayModelCache();
    let keyReads = 0;
    let fetchCalls = 0;
    const env = new Proxy({
        PLOINKY_ROUTER_DESCRIPTOR_FILE: '/run/ploinky/router-descriptor.json',
        SOUL_GATEWAY_BASE_URL: 'https://external.invalid/v1',
        SOUL_GATEWAY_API_KEY: 'external-key',
    }, {
        get(target, name) {
            if (name === 'PLOINKY_AGENT_API_KEY' || name === 'SOUL_GATEWAY_API_KEY') keyReads += 1;
            return target[name];
        },
    });
    const failure = Object.assign(new Error('incomplete descriptor bundle'), {
        code: 'PLOINKY_DESCRIPTOR_MIRROR_MISMATCH',
    });
    const generatedLocalApi = {
        ...externalOnlyApi(),
        loadGeneratedLocalRouterDescriptor() {
            throw failure;
        },
    };

    await assert.rejects(
        loadSoulGatewayModels({
            env,
            generatedLocalApi,
            fetchImpl: async () => {
                fetchCalls += 1;
            },
        }),
        (error) => error === failure,
    );
    assert.equal(keyReads, 0);
    assert.equal(fetchCalls, 0);
    clearSoulGatewayModelCache();
});
