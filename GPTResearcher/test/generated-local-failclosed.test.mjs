import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { main as listSoulGatewayModels } from '../scripts/list-soul-gateway-models.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const scriptsDirectory = path.resolve(testDirectory, '../scripts');

test('Node discovery rejects generated-local before key access or fetch', async () => {
    for (const signal of [
        'PLOINKY_ROUTER_DESCRIPTOR_FILE',
        'PLOINKY_ROUTER_URL',
        'PLOINKY_AGENT_API_KEY',
        'PLOINKY_ENV_SOURCE_PLOINKY_AGENT_API_KEY',
        'PLOINKY_ENV_SOURCE_PLOINKY_UNKNOWN_RUNTIME_FIELD',
    ]) {
        let keyReads = 0;
        let fetchCalls = 0;
        const values = {
            [signal]: signal.startsWith('PLOINKY_ENV_SOURCE_') ? 'generated' : 'present',
            PLOINKY_AGENT_API_KEY: 'must-not-be-read',
        };
        const env = new Proxy(values, {
            get(target, property, receiver) {
                if (property === 'PLOINKY_AGENT_API_KEY') keyReads += 1;
                return Reflect.get(target, property, receiver);
            },
        });

        await assert.rejects(
            listSoulGatewayModels({
                env,
                fetchImpl: async () => {
                    fetchCalls += 1;
                    throw new Error('fetch must not run');
                },
            }),
            (error) => error?.code === 'PLOINKY_LOCAL_GENERATED_CONSUMER_NOT_CERTIFIED',
        );
        assert.equal(keyReads, 0, signal);
        assert.equal(fetchCalls, 0, signal);
    }
});

test('Python provider rejects generated-local before key mapping access', () => {
    const script = String.raw`
from gpt_researcher_agent import soul_gateway

class GuardedEnv(dict):
    def get(self, name, default=None):
        if name == "PLOINKY_AGENT_API_KEY":
            raise AssertionError("generated key was read")
        return super().get(name, default)

env = GuardedEnv({
    "PLOINKY_ENV_SOURCE_PLOINKY_UNKNOWN_RUNTIME_FIELD": "generated",
})
try:
    soul_gateway.soul_gateway_router_base_url(env)
except RuntimeError as error:
    assert "PLOINKY_LOCAL_GENERATED_CONSUMER_NOT_CERTIFIED" in str(error)
else:
    raise AssertionError("generated-local provider was not rejected")

try:
    soul_gateway.soul_gateway_api_key(env)
except RuntimeError as error:
    assert "PLOINKY_LOCAL_GENERATED_CONSUMER_NOT_CERTIFIED" in str(error)
else:
    raise AssertionError("generated-local key accessor was not rejected")
`;
    const result = spawnSync('python3', ['-c', script], {
        cwd: scriptsDirectory,
        env: {
            ...process.env,
            PYTHONPATH: scriptsDirectory,
        },
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('GPTResearcher ordinary Ploinky identity does not claim generated-local authority', async () => {
    const ordinaryIdentity = {
        PLOINKY_AGENT_ID: 'agent:repo/researcher',
        PLOINKY_AGENT_PRINCIPAL: 'agent:repo/researcher',
        PLOINKY_AGENT_INSTANCE_ID: 'ordinary-instance',
        PLOINKY_AGENT_ENABLE_GENERATION: 'ordinary-generation',
    };
    await assert.rejects(
        listSoulGatewayModels({ env: ordinaryIdentity }),
        (error) => error?.code !== 'PLOINKY_LOCAL_GENERATED_CONSUMER_NOT_CERTIFIED'
            && /PLOINKY_ROUTER_URL is required/.test(error?.message || ''),
    );

    const script = String.raw`
from gpt_researcher_agent import soul_gateway

env = {
    "PLOINKY_AGENT_ID": "agent:repo/researcher",
    "PLOINKY_AGENT_PRINCIPAL": "agent:repo/researcher",
    "PLOINKY_AGENT_INSTANCE_ID": "ordinary-instance",
    "PLOINKY_AGENT_ENABLE_GENERATION": "ordinary-generation",
}
soul_gateway.assert_generated_local_consumer_certified(env)
`;
    const result = spawnSync('python3', ['-c', script], {
        cwd: scriptsDirectory,
        env: {
            ...process.env,
            PYTHONPATH: scriptsDirectory,
        },
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
