const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 5_000;

let generatedLocalApiPromise = null;

const RECOMMENDED_MODEL_NAMES = new Map([
    ['fast', 0],
    ['plan', 1],
    ['deep', 2],
    ['chat', 3],
    ['coding', 4],
    ['reasoning', 5],
    ['tool-calling', 6],
    ['free', 7],
]);

let catalogCache = null;
let catalogCacheExpiresAt = 0;
let catalogCacheKey = null;

function normalizeBaseUrl(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    try {
        return new URL(text.endsWith('/') ? text : `${text}/`);
    } catch {
        throw new Error(`Invalid Soul Gateway base URL: ${text}`);
    }
}

export function resolveSoulGatewayModelsUrl(env = process.env) {
    const explicitBase = normalizeBaseUrl(env.SOUL_GATEWAY_BASE_URL);
    if (!explicitBase) {
        throw new Error('Soul Gateway is unavailable because SOUL_GATEWAY_BASE_URL is not set.');
    }
    const pathname = explicitBase.pathname.replace(/\/+$/, '');
    explicitBase.pathname = pathname.endsWith('/v1')
        ? `${pathname}/models`
        : `${pathname}/v1/models`;
    explicitBase.search = '';
    explicitBase.hash = '';
    return explicitBase;
}

async function importGeneratedLocalApi() {
    const [descriptorApi, transportApi] = await Promise.all([
        import('achillesAgentLib/utils/LLMProviders/transport/generatedLocalRouterDescriptor.mjs'),
        import('achillesAgentLib/utils/LLMProviders/transport/routerHttpTransport.mjs'),
    ]);
    return Object.freeze({
        ...descriptorApi,
        routerHttpRequest: transportApi.routerHttpRequest,
    });
}

async function resolveGeneratedLocalApi(injectedApi) {
    if (injectedApi) return injectedApi;
    generatedLocalApiPromise ||= importGeneratedLocalApi();
    return generatedLocalApiPromise;
}

function requireGeneratedLocalApi(api) {
    const required = [
        'loadGeneratedLocalRouterDescriptor',
        'refreshGeneratedLocalRouterDescriptor',
        'buildGeneratedLocalOperationURL',
        'routerHttpRequest',
    ];
    for (const name of required) {
        if (typeof api?.[name] !== 'function') {
            throw new TypeError(`Generated-local AgentLib API is missing ${name}().`);
        }
    }
    if (typeof api.GENERATED_LOCAL_MODELS_PATH !== 'string') {
        throw new TypeError('Generated-local AgentLib API is missing its exact models path.');
    }
    return api;
}

export async function validateGeneratedLocalStartup(options = {}) {
    const env = options.env || process.env;
    const api = requireGeneratedLocalApi(await resolveGeneratedLocalApi(options.generatedLocalApi));
    const descriptor = api.loadGeneratedLocalRouterDescriptor({ env });
    if (!descriptor) return null;
    return api.refreshGeneratedLocalRouterDescriptor(descriptor, { env });
}

export function resolveSoulGatewayApiKey(env = process.env) {
    return String(env.SOUL_GATEWAY_API_KEY || '').trim();
}

function normalizeTags(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
        .map((tag) => String(tag || '').trim())
        .filter(Boolean))];
}

function normalizeModel(entry, index) {
    if (!entry || typeof entry !== 'object') return null;
    const name = String(entry.id || '').trim();
    if (!name || entry._alias === true) return null;

    return {
        name,
        provider: String(entry.owned_by || entry.provider || '').trim() || 'soul-gateway',
        tags: normalizeTags(entry._tags || entry.tags),
        strategy: entry._strategy === 'cascade' ? 'cascade' : 'direct',
        childCount: Number.isFinite(Number(entry._child_count))
            ? Number(entry._child_count)
            : null,
        isFree: entry._is_free === true,
        contextWindow: Number.isFinite(Number(entry?._context?.window))
            ? Number(entry._context.window)
            : null,
        sourceIndex: index,
    };
}

function sortModels(models, selectedModel = null) {
    const selected = String(selectedModel || '').trim().toLowerCase();
    return models.slice().sort((left, right) => {
        const leftName = left.name.toLowerCase();
        const rightName = right.name.toLowerCase();
        const leftSelected = selected && leftName === selected;
        const rightSelected = selected && rightName === selected;
        if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;

        const leftRecommendation = RECOMMENDED_MODEL_NAMES.get(leftName);
        const rightRecommendation = RECOMMENDED_MODEL_NAMES.get(rightName);
        const leftRank = leftRecommendation ?? Number.MAX_SAFE_INTEGER;
        const rightRank = rightRecommendation ?? Number.MAX_SAFE_INTEGER;
        if (leftRank !== rightRank) return leftRank - rightRank;

        return left.sourceIndex - right.sourceIndex;
    });
}

export function normalizeSoulGatewayModelCatalog(payload, options = {}) {
    const rawModels = Array.isArray(payload?.data) ? payload.data : [];
    const uniqueModels = new Map();
    rawModels.forEach((entry, index) => {
        const model = normalizeModel(entry, index);
        if (model && !uniqueModels.has(model.name)) {
            uniqueModels.set(model.name, model);
        }
    });
    return sortModels([...uniqueModels.values()], options.selectedModel);
}

function compactNumber(value) {
    if (!Number.isFinite(value) || value <= 0) return '';
    if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
    if (value >= 1_000) return `${Math.round(value / 100) / 10}K`;
    return String(value);
}

export function formatSoulGatewayModelDescription(model) {
    const parts = [model.provider];
    if (model.strategy === 'cascade') {
        const count = Number.isFinite(model.childCount) ? ` · ${model.childCount} models` : '';
        parts.push(`Cascade${count}`);
    }
    if (model.isFree) parts.push('Free');
    if (model.contextWindow) parts.push(`${compactNumber(model.contextWindow)} context`);
    const usefulTags = model.tags
        .filter((tag) => tag !== 'chat')
        .slice(0, 3);
    if (usefulTags.length > 0) parts.push(usefulTags.join(', '));
    return parts.join(' · ');
}

export function toModelCompletions(models) {
    return (Array.isArray(models) ? models : []).map((model) => ({
        value: model.name,
        label: model.name,
        description: formatSoulGatewayModelDescription(model),
    }));
}

export async function loadSoulGatewayModels(options = {}) {
    const {
        env = process.env,
        fetchImpl = globalThis.fetch,
        cacheTtlMs = DEFAULT_CACHE_TTL_MS,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        forceRefresh = false,
        selectedModel = null,
        generatedLocalApi = null,
    } = options;

    const api = requireGeneratedLocalApi(await resolveGeneratedLocalApi(generatedLocalApi));
    const initialDescriptor = api.loadGeneratedLocalRouterDescriptor({ env });
    const descriptor = initialDescriptor
        ? api.refreshGeneratedLocalRouterDescriptor(initialDescriptor, { env })
        : null;
    if (descriptor) {
        api.buildGeneratedLocalOperationURL(descriptor, api.GENERATED_LOCAL_MODELS_PATH);
    }
    const externalUrl = descriptor ? null : resolveSoulGatewayModelsUrl(env);
    const cacheKey = descriptor
        ? `generated:${descriptor.envelopeDigest}`
        : `external:${externalUrl.href}`;
    const now = Date.now();
    if (!forceRefresh
        && catalogCache
        && catalogCacheKey === cacheKey
        && now < catalogCacheExpiresAt) {
        return sortModels(catalogCache, selectedModel);
    }
    if (!descriptor && typeof fetchImpl !== 'function') {
        throw new Error('External Soul Gateway model discovery requires fetch support.');
    }

    // Descriptor presence, provenance, signature, mirrors, operation path, and
    // freshness are all checked before this generated credential is read.
    const apiKey = descriptor
        ? String(env.PLOINKY_AGENT_API_KEY || '').trim()
        : resolveSoulGatewayApiKey(env);
    if (!apiKey) {
        throw new Error(descriptor
            ? 'Generated-local Soul Gateway model discovery requires PLOINKY_AGENT_API_KEY.'
            : 'External Soul Gateway model discovery requires SOUL_GATEWAY_API_KEY.');
    }

    const signal = typeof AbortSignal?.timeout === 'function'
        ? AbortSignal.timeout(timeoutMs)
        : undefined;
    let response;
    try {
        if (descriptor) {
            response = await api.routerHttpRequest({
                descriptor,
                pathname: api.GENERATED_LOCAL_MODELS_PATH,
                method: 'GET',
                bearer: apiKey,
                accept: 'application/json',
                totalTimeoutMs: timeoutMs,
                ...(signal ? { signal } : {}),
            });
        } else {
            response = await fetchImpl(externalUrl, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    Accept: 'application/json',
                },
                ...(signal ? { signal } : {}),
            });
        }
    } catch (error) {
        const wrapped = new Error(`Could not load models from Soul Gateway: ${error.message}`, { cause: error });
        if (error?.code) wrapped.code = error.code;
        throw wrapped;
    }

    if (!response?.ok) {
        const details = await response?.text?.().catch(() => '');
        const suffix = details ? `: ${details.slice(0, 200)}` : '';
        throw new Error(`Soul Gateway model discovery failed (${response?.status || 'unknown'})${suffix}`);
    }

    const payload = await response.json();
    const models = normalizeSoulGatewayModelCatalog(payload);
    if (models.length === 0) {
        throw new Error('Soul Gateway returned no selectable models.');
    }

    catalogCache = models;
    catalogCacheKey = cacheKey;
    catalogCacheExpiresAt = now + Math.max(0, Number(cacheTtlMs) || 0);
    return sortModels(models, selectedModel);
}

export function clearSoulGatewayModelCache() {
    catalogCache = null;
    catalogCacheKey = null;
    catalogCacheExpiresAt = 0;
}
