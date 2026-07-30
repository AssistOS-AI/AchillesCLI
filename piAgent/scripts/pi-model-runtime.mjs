import path from 'node:path';
import { pathToFileURL } from 'node:url';

const OAUTH_KINDS = new Map([
    ['anthropic', 'manual_oauth_code'],
    ['github-copilot', 'device_code'],
    ['kimi-coding', 'device_code'],
    ['openai-codex', 'device_code'],
    ['openrouter', 'manual_oauth_code'],
    ['radius', 'device_code'],
    ['xai', 'device_code'],
]);

export async function createPiModelRuntime(env = process.env) {
    const home = String(env.HOME || '/root');
    const entry = path.join(home, '.local', 'lib', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js');
    const module = await import(pathToFileURL(entry).href);
    return module.ModelRuntime.create({ allowModelNetwork: false });
}

export function piProviderDescriptors(runtime) {
    return runtime.getProviders().map((provider) => {
        const methods = [];
        if (provider?.auth?.apiKey?.login) {
            methods.push({
                key: 'api_key',
                kind: 'api_key',
                label: provider.auth.apiKey.name || 'API key',
            });
        }
        const oauthKind = OAUTH_KINDS.get(String(provider?.id || ''));
        if (provider?.auth?.oauth?.login && oauthKind) {
            methods.push({
                key: 'oauth',
                kind: oauthKind,
                label: provider.auth.oauth.loginLabel || provider.auth.oauth.name || 'Browser authentication',
            });
        }
        return {
            key: String(provider.id || ''),
            label: String(provider.name || provider.id || ''),
            methods,
        };
    }).filter((provider) => provider.key && provider.methods.length);
}

export const __testables = { OAUTH_KINDS };
