const DEVICE_LABEL_RE = /(?:headless|remote|\bvps\b|device\s*code)/i;
const ACCESS_TOKEN_LABEL_RE = /(?:access\s*token|personal\s*access\s*token|\bpat\b|bearer\s*token)/i;

function methodKind(provider, method) {
    const label = String(method?.label || '');
    if (method?.type === 'api') {
        if (ACCESS_TOKEN_LABEL_RE.test(label)) return 'access_token';
        return Array.isArray(method.prompts) && method.prompts.length
            ? 'credential_form'
            : 'api_key';
    }
    if (method?.type !== 'oauth') return '';
    if (DEVICE_LABEL_RE.test(label) || provider === 'github-copilot') return 'device_code';
    return '';
}

export function providerCatalog(methodsByProvider) {
    return Object.entries(methodsByProvider || {}).map(([provider, methods]) => ({
        key: provider,
        label: provider,
        methods: (Array.isArray(methods) ? methods : []).map((method, index) => {
            const kind = methodKind(provider, method);
            if (!kind) return null;
            return {
                key: method.type === 'api' ? `api_key:${index}` : `oauth:${index}`,
                kind,
                label: String(method.label || (method.type === 'api' ? 'API key' : 'Browser (device code)')),
                secret: method.type === 'api',
                prompts: Array.isArray(method.prompts) ? method.prompts : [],
            };
        }).filter(Boolean),
    })).filter((provider) => provider.methods.length);
}

function codeFromText(value) {
    const text = String(value || '');
    const match = text.match(/\b(?:enter|use)\s+(?:the\s+)?code[:\s]+([A-Z0-9-]{4,})/i)
        || text.match(/\bcode[:\s]+([A-Z0-9-]{4,})/i);
    return match?.[1] || '';
}

export function authorizationChallenge(authorization, declaredKind) {
    const url = String(authorization?.url || '').trim();
    const instructions = String(authorization?.instructions || '').trim();
    if (authorization?.method === 'code') {
        return {
            type: 'manual_oauth_code',
            ...(url ? { url } : {}),
            ...(instructions ? { instructions } : {}),
        };
    }
    if (authorization?.method === 'auto' && declaredKind === 'device_code') {
        let userCode = '';
        try {
            const parsed = new URL(url);
            userCode = parsed.searchParams.get('user_code') || parsed.searchParams.get('code') || '';
        } catch (_) { }
        userCode ||= codeFromText(instructions);
        return {
            type: 'device_code',
            ...(url ? { verificationUri: url } : {}),
            ...(userCode ? { userCode } : {}),
            ...(instructions ? { instructions } : {}),
        };
    }
    throw new Error('unsupported_container_login_flow');
}

export const __testables = { methodKind, codeFromText };
