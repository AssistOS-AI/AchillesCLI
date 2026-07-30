import assert from 'node:assert/strict';
import test from 'node:test';

import { __testables as codex } from '../../codexAgent/scripts/task-session-control.mjs';
import {
    authorizationChallenge,
    providerCatalog,
} from '../../opencodeAgent/scripts/login-methods.mjs';
import { piProviderDescriptors } from '../../piAgent/scripts/pi-model-runtime.mjs';

test('Codex exposes secret credentials and device code without local callback login', () => {
    const methods = codex.PROVIDERS[0].methods;
    assert.deepEqual(methods.map((method) => method.kind), [
        'api_key', 'access_token', 'device_code',
    ]);
    assert.equal(methods.some((method) => method.key === 'browser'), false);
});

test('OpenCode catalog keeps API credentials and explicitly headless OAuth only', () => {
    const providers = providerCatalog({
        openai: [
            { type: 'oauth', label: 'ChatGPT Pro/Plus (browser)' },
            { type: 'oauth', label: 'ChatGPT Pro/Plus (headless)' },
            { type: 'api', label: 'Manually enter API Key' },
        ],
        gitlab: [{ type: 'oauth', label: 'GitLab OAuth' }],
        'github-copilot': [{ type: 'oauth', label: 'Login with GitHub Copilot' }],
    });
    assert.deepEqual(providers.find((provider) => provider.key === 'openai').methods.map((method) => ({
        key: method.key,
        kind: method.kind,
    })), [
        { key: 'oauth:1', kind: 'device_code' },
        { key: 'api_key:2', kind: 'api_key' },
    ]);
    assert.equal(providers.some((provider) => provider.key === 'gitlab'), false);
    assert.equal(providers.find((provider) => provider.key === 'github-copilot').methods[0].kind, 'device_code');
});

test('OpenCode authorization responses become only device or manual-code challenges', () => {
    assert.deepEqual(authorizationChallenge({
        method: 'auto',
        url: 'https://example.com/device',
        instructions: 'Enter code ABCD-EFGH',
    }, 'device_code'), {
        type: 'device_code',
        verificationUri: 'https://example.com/device',
        userCode: 'ABCD-EFGH',
        instructions: 'Enter code ABCD-EFGH',
    });
    assert.deepEqual(authorizationChallenge({
        method: 'code',
        url: 'https://example.com/authorize',
        instructions: 'Paste the returned code.',
    }, 'device_code'), {
        type: 'manual_oauth_code',
        url: 'https://example.com/authorize',
        instructions: 'Paste the returned code.',
    });
    assert.throws(() => authorizationChallenge({ method: 'auto', url: 'https://example.com' }, 'manual_oauth_code'));
});

test('PI catalog maps only known container-compatible OAuth providers', () => {
    const provider = (id, { apiKey = false, oauth = false } = {}) => ({
        id,
        name: id,
        auth: {
            ...(apiKey ? { apiKey: { name: 'API key', login() {} } } : {}),
            ...(oauth ? { oauth: { name: 'OAuth', login() {} } } : {}),
        },
    });
    const descriptors = piProviderDescriptors({
        getProviders: () => [
            provider('anthropic', { apiKey: true, oauth: true }),
            provider('xai', { oauth: true }),
            provider('custom-callback-only', { oauth: true }),
        ],
    });
    assert.deepEqual(descriptors.map((entry) => [
        entry.key,
        entry.methods.map((method) => method.kind),
    ]), [
        ['anthropic', ['api_key', 'manual_oauth_code']],
        ['xai', ['device_code']],
    ]);
});
