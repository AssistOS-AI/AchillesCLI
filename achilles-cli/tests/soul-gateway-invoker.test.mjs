import assert from 'node:assert/strict';
import test from 'node:test';

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
