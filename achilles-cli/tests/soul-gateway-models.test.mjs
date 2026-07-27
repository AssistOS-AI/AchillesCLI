import test from 'node:test';
import assert from 'node:assert/strict';

import {
    clearSoulGatewayModelCache,
    formatSoulGatewayModelDescription,
    loadSoulGatewayModels,
    normalizeSoulGatewayModelCatalog,
    resolveSoulGatewayModelsUrl,
} from '../src/lib/soulGatewayModels.mjs';

test('Soul Gateway model URL uses the router-mediated service route', () => {
    const url = resolveSoulGatewayModelsUrl({
        PLOINKY_ROUTER_URL: 'http://host.containers.internal:8080',
        SOUL_GATEWAY_BASE_URL: 'https://external.invalid/v1',
    });
    assert.equal(url.href, 'http://host.containers.internal:8080/base-agent-additional-server/soul-gateway/7000/v1/models');
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
            PLOINKY_ROUTER_URL: 'http://router.test:8080',
            PLOINKY_AGENT_API_KEY: 'agent:test/key',
        },
        fetchImpl,
    };

    const first = await loadSoulGatewayModels(options);
    const second = await loadSoulGatewayModels(options);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://router.test:8080/base-agent-additional-server/soul-gateway/7000/v1/models');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer agent:test/key');
    assert.equal(first[0].name, 'fast');
    assert.equal(second[0].name, 'fast');
    clearSoulGatewayModelCache();
});
