import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function createPiModelRuntime(env = process.env) {
    const home = String(env.HOME || '/root');
    const entry = path.join(home, '.local', 'lib', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js');
    const module = await import(pathToFileURL(entry).href);
    return module.ModelRuntime.create({ allowModelNetwork: false });
}

export function piProviderDescriptors(runtime) {
    return runtime.getProviders().map((provider) => {
        const methods = [];
        if (provider?.auth?.apiKey?.login) methods.push({ key: 'api_key', label: provider.auth.apiKey.name || 'API key' });
        if (provider?.auth?.oauth?.login) methods.push({ key: 'oauth', label: provider.auth.oauth.loginLabel || provider.auth.oauth.name || 'Browser / OAuth' });
        return {
            key: String(provider.id || ''),
            label: String(provider.name || provider.id || ''),
            methods,
        };
    }).filter((provider) => provider.key && provider.methods.length);
}
