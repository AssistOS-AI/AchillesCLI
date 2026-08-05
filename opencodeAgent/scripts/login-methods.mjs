// OpenCode is pinned to 1.14.19 by install-opencode.sh. Its auth CLI exposes no
// machine-readable catalog, so this is intentionally a version-pinned contract.
// Upgrade this table and its CLI probes together when the pin changes.
function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

const METHODS = deepFreeze([
    {
        key: 'openai',
        label: 'openai',
        methods: [
            {
                key: 'oauth:1', kind: 'device_code', label: 'ChatGPT Pro/Plus (headless)',
                verificationUri: 'https://auth.openai.com/codex/device',
            },
            {
                key: 'api_key:2', kind: 'api_key', label: 'Manually enter API Key',
                secret: true, completionMarker: 'done',
            },
        ],
    },
    {
        key: 'github-copilot',
        label: 'github-copilot',
        methods: [{
            key: 'oauth:0',
            kind: 'device_code',
            label: 'Login with GitHub Copilot',
            verificationUri: 'https://github.com/login/device',
            prompts: [{
                type: 'select',
                key: 'deploymentType',
                message: 'Select GitHub deployment type',
                options: [
                    { label: 'GitHub.com', value: 'github.com', hint: 'Public' },
                    {
                        label: 'GitHub Enterprise', value: 'enterprise',
                        hint: 'Data residency or self-hosted',
                    },
                ],
            }, {
                type: 'text',
                key: 'enterpriseUrl',
                message: 'Enter your GitHub Enterprise URL or domain',
                placeholder: 'company.ghe.com or https://company.ghe.com',
                when: { key: 'deploymentType', op: 'eq', value: 'enterprise' },
            }],
        }],
    },
    {
        key: 'gitlab',
        label: 'gitlab',
        methods: [{
            key: 'api_key:1', kind: 'credential_form',
            label: 'GitLab Personal Access Token', secret: true,
            completionMarker: 'login_successful',
            prompts: [{
                type: 'secret', key: 'token', message: 'Personal Access Token',
                placeholder: 'glpat-xxxxxxxxxxxxxxxxxxxx',
            }],
        }],
    },
    {
        key: 'poe',
        label: 'poe',
        methods: [{
            key: 'api_key:1', kind: 'api_key', label: 'Manually enter API Key', secret: true,
            completionMarker: 'done',
        }],
    },
    {
        key: 'cloudflare-workers-ai',
        label: 'cloudflare-workers-ai',
        methods: [{
            key: 'api_key:0', kind: 'credential_form', label: 'API key', secret: true,
            completionMarker: 'done',
            prompts: [{
                type: 'text', key: 'accountId', message: 'Enter your Cloudflare Account ID',
                placeholder: 'e.g. 1234567890abcdef1234567890abcdef',
            }],
        }],
    },
    {
        key: 'cloudflare-ai-gateway',
        label: 'cloudflare-ai-gateway',
        methods: [{
            key: 'api_key:0', kind: 'credential_form', label: 'Gateway API token', secret: true,
            completionMarker: 'done',
            prompts: [{
                type: 'text', key: 'accountId', message: 'Enter your Cloudflare Account ID',
                placeholder: 'e.g. 1234567890abcdef1234567890abcdef',
            }, {
                type: 'text', key: 'gatewayId', message: 'Enter your Cloudflare AI Gateway ID',
                placeholder: 'e.g. my-gateway',
            }],
        }],
    },
]);

function publicMethod(method) {
    const {
        verificationUri: _verificationUri,
        completionMarker: _completionMarker,
        ...result
    } = method;
    return result;
}

export const OPENCODE_LOGIN_PROVIDERS = deepFreeze(METHODS.map((provider) => ({
    key: provider.key,
    label: provider.label,
    methods: provider.methods.map(publicMethod),
})));

export function selectLoginMethod(providerKey, methodKey) {
    const provider = METHODS.find((entry) => entry.key === providerKey);
    const method = provider?.methods.find((entry) => entry.key === methodKey);
    return provider && method ? Object.freeze({ provider, method }) : null;
}

export const __testables = Object.freeze({ METHODS, deepFreeze, publicMethod });
