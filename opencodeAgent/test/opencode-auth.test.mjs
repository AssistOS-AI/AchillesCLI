import assert from 'node:assert/strict';
import test from 'node:test';

import { beginOpenCodeOAuthAuthorization } from '../scripts/opencode-auth.mjs';

test('a new OpenCode OAuth flow removes existing provider auth before authorization', async () => {
    const calls = [];
    const server = { baseUrl: 'http://127.0.0.1:7000' };
    const request = async (actualServer, pathname, options) => {
        calls.push({ actualServer, pathname, options });
        if (options.method === 'DELETE') return true;
        return {
            method: 'auto',
            url: 'https://example.com/device',
            instructions: 'Enter code ABCD-EFGH',
        };
    };

    const result = await beginOpenCodeOAuthAuthorization(server, {
        provider: 'openai/account',
        methodIndex: 1,
        inputs: { deploymentType: 'github.com' },
    }, { request });

    assert.deepEqual(calls, [{
        actualServer: server,
        pathname: '/auth/openai%2Faccount',
        options: { method: 'DELETE' },
    }, {
        actualServer: server,
        pathname: '/provider/openai%2Faccount/oauth/authorize',
        options: {
            method: 'POST',
            body: JSON.stringify({
                method: 1,
                inputs: { deploymentType: 'github.com' },
            }),
        },
    }]);
    assert.equal(result.method, 'auto');
});

test('OpenCode OAuth authorization stops when old credentials cannot be removed', async () => {
    const calls = [];
    await assert.rejects(beginOpenCodeOAuthAuthorization({}, {
        provider: 'openai',
        methodIndex: 1,
    }, {
        request: async (_server, pathname) => {
            calls.push(pathname);
            throw new Error('remove_failed');
        },
    }), /remove_failed/);
    assert.deepEqual(calls, ['/auth/openai']);
});
