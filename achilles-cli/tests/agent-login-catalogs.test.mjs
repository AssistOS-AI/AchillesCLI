import assert from 'node:assert/strict';
import test from 'node:test';

import { __testables as codex } from '../../codexAgent/scripts/task-session-control.mjs';
import { OPENCODE_LOGIN_PROVIDERS } from '../../opencodeAgent/scripts/login-methods.mjs';
import { __testables as piControl } from '../../piAgent/extensions/ploinky-control.mjs';

test('Codex exposes secret credentials and device code without local callback login', () => {
    const methods = codex.PROVIDERS[0].methods;
    assert.deepEqual(methods.map((method) => method.kind), [
        'api_key', 'access_token', 'device_code',
    ]);
    assert.equal(methods.some((method) => method.key === 'browser'), false);
});

test('OpenCode catalog keeps API credentials and explicitly headless OAuth only', () => {
    assert.deepEqual(OPENCODE_LOGIN_PROVIDERS.find((provider) => provider.key === 'openai').methods.map((method) => ({
        key: method.key,
        kind: method.kind,
    })), [
        { key: 'oauth:1', kind: 'device_code' },
        { key: 'api_key:2', kind: 'api_key' },
    ]);
    assert.deepEqual(
        OPENCODE_LOGIN_PROVIDERS.find((provider) => provider.key === 'gitlab').methods.map((method) => method.kind),
        ['credential_form'],
    );
    assert.equal(
        OPENCODE_LOGIN_PROVIDERS.find((provider) => provider.key === 'github-copilot').methods[0].kind,
        'device_code',
    );
});

test('OpenCode catalog is pinned and exposes no browser callback login method', () => {
    const kinds = OPENCODE_LOGIN_PROVIDERS.flatMap((provider) => (
        provider.methods.map((method) => method.kind)
    ));
    assert.equal(kinds.includes('browser'), false);
    assert.equal(kinds.includes('browser_callback'), false);
    assert.equal(kinds.includes('manual_oauth_code'), false);
    assert.deepEqual([...new Set(kinds)].sort(), [
        'api_key',
        'credential_form',
        'device_code',
    ]);
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
    const descriptors = piControl.providerDescriptors({
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
