import { openCodeJson } from './opencode-control-server.mjs';

export async function beginOpenCodeOAuthAuthorization(server, {
    provider,
    methodIndex,
    inputs = {},
} = {}, {
    request = openCodeJson,
} = {}) {
    const providerId = String(provider || '').trim();
    if (!providerId) throw new Error('provider_required');
    if (!Number.isInteger(methodIndex) || methodIndex < 0) throw new Error('invalid_login_method');

    const providerPath = encodeURIComponent(providerId);
    await request(server, `/auth/${providerPath}`, { method: 'DELETE' });
    return request(server, `/provider/${providerPath}/oauth/authorize`, {
        method: 'POST',
        body: JSON.stringify({ method: methodIndex, inputs }),
    });
}
