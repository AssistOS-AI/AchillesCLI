import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { validateGeneratedLocalStartup } from '../src/lib/soulGatewayModels.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '../..', '..');
const fixtureRoot = path.join(workspaceRoot, 'ploinky', 'tests', 'fixtures', 'router-descriptor');
const agentLibRoot = path.join(workspaceRoot, 'ploinky', 'node_modules', 'achillesAgentLib');

function sha256(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

test('AchillesCLI consumes the exact frozen canonical descriptor fixture bytes', () => {
    const vectors = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'vectors.json'), 'utf8'));
    for (const fileName of [
        'public-envelope.json',
        'managed-envelope.json',
        'streaming-enabled-envelope.json',
    ]) {
        const bytes = fs.readFileSync(path.join(fixtureRoot, fileName));
        assert.equal(bytes.at(-1), 0x7d, `${fileName} must end at the canonical JSON object`);
        assert.equal(
            `sha256:${sha256(bytes)}`,
            vectors.files[fileName],
            `${fileName} drifted from the cross-repository vector`,
        );
    }
});

test('startup accepts a valid signed fixture through the AgentLib verifier brand', () => {
    const fixtureEnv = JSON.parse(fs.readFileSync(
        path.join(fixtureRoot, 'public-environment.json'),
        'utf8',
    ));
    fixtureEnv.PLOINKY_ROUTER_DESCRIPTOR_FILE = path.join(fixtureRoot, 'public-envelope.json');
    const cliModuleUrl = pathToFileURL(path.resolve(import.meta.dirname, '../src/lib/soulGatewayModels.mjs')).href;
    const descriptorModuleUrl = pathToFileURL(path.join(
        agentLibRoot,
        'utils',
        'LLMProviders',
        'transport',
        'generatedLocalRouterDescriptor.mjs',
    )).href;
    const childSource = `
        const cli = await import(${JSON.stringify(cliModuleUrl)});
        const descriptorApi = await import(${JSON.stringify(descriptorModuleUrl)});
        const descriptor = await cli.validateGeneratedLocalStartup({
            env: process.env,
            generatedLocalApi: { ...descriptorApi, routerHttpRequest() { throw new Error('no request expected'); } },
        });
        if (!descriptorApi.isVerifiedGeneratedLocalRouterDescriptor(descriptor)) process.exit(21);
        process.stdout.write(descriptor.envelopeDigest);
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', childSource], {
        cwd: workspaceRoot,
        env: fixtureEnv,
        encoding: 'utf8',
        timeout: 5_000,
    });

    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.equal(
        child.stdout,
        `sha256:${sha256(fs.readFileSync(path.join(fixtureRoot, 'public-envelope.json')))}`,
    );
});

test('partial generated-local startup fails before key access and cannot return external state', async () => {
    let keyReads = 0;
    const env = new Proxy({
        PLOINKY_ROUTER_DESCRIPTOR_FILE: '/run/ploinky/router-descriptor.json',
        SOUL_GATEWAY_BASE_URL: 'https://external.invalid/v1',
    }, {
        get(target, name) {
            if (name === 'PLOINKY_AGENT_API_KEY' || name === 'SOUL_GATEWAY_API_KEY') keyReads += 1;
            return target[name];
        },
    });
    const failure = Object.assign(new Error('invalid generated-local descriptor'), {
        code: 'PLOINKY_DESCRIPTOR_SIGNATURE_INVALID',
    });

    await assert.rejects(
        validateGeneratedLocalStartup({
            env,
            generatedLocalApi: {
                GENERATED_LOCAL_MODELS_PATH: '/base-agent-additional-server/soul-gateway/7000/v1/models',
                loadGeneratedLocalRouterDescriptor() {
                    throw failure;
                },
                refreshGeneratedLocalRouterDescriptor() {},
                buildGeneratedLocalOperationURL() {},
                routerHttpRequest() {},
            },
        }),
        (error) => error === failure,
    );
    assert.equal(keyReads, 0);
});

test('the CLI performs generated-local validation before broker construction', () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, '../src/index.mjs'), 'utf8');
    const mainStart = source.indexOf('async function main()');
    const validation = source.indexOf('await validateGeneratedLocalStartup()', mainStart);
    const args = source.indexOf('const args = process.argv.slice(2)', mainStart);
    const broker = source.indexOf('const brokerClient = new BrokerClient()', mainStart);
    const invoker = source.indexOf('createSoulGatewayInvoker(defaultLLMInvokerStrategy', mainStart);

    assert.ok(mainStart >= 0 && mainStart < validation);
    assert.ok(validation < args && args < broker && broker < invoker);
});
