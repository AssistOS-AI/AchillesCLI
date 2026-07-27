#!/usr/bin/env node

function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function asArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
    return [];
}

function normalizeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function readField(row, camelName, snakeName, fallback = null) {
    if (row && Object.prototype.hasOwnProperty.call(row, camelName)) {
        return row[camelName];
    }
    if (row && Object.prototype.hasOwnProperty.call(row, snakeName)) {
        return row[snakeName];
    }
    return fallback;
}

function lowerWords(...values) {
    return values
        .flatMap((value) => {
            if (Array.isArray(value)) return value;
            if (value && typeof value === 'object') return Object.keys(value);
            return [value];
        })
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
}

const SEARCH_PROVIDER_KEYS = new Set([
    'tavily',
    'brave',
    'exa',
    'serper',
    'jina',
    'duckduckgo',
    'searxng',
    'gemini',
    'gemini-search',
    'google-ai-mode',
    'deep-research',
]);

function isEmbeddingModel(model) {
    const tags = asArray(model.tags);
    const haystack = lowerWords(model.id, model.label, model.providerModelId, tags);
    return /\b(embed|embedding|embeddings)\b/.test(haystack) || haystack.includes('text-embedding');
}

function isSearchModel(model) {
    const tags = asArray(model.tags);
    const providerKey = trim(model.providerKey).toLowerCase();
    if (
        SEARCH_PROVIDER_KEYS.has(providerKey) ||
        tags.includes('search') ||
        trim(model.kind).toLowerCase() === 'search' ||
        trim(model.type).toLowerCase() === 'search' ||
        trim(model.providerKind).toLowerCase() === 'search' ||
        trim(model.adapterKey).toLowerCase() === 'search-builtin' ||
        trim(model.backendKey).toLowerCase() === 'search-builtin' ||
        trim(model.adapterKey).toLowerCase() === 'headless-search' ||
        trim(model.backendKey).toLowerCase() === 'headless-search'
    ) {
        return true;
    }
    return false;
}

function normalizeModel(row) {
    const id = trim(readField(row, 'modelKey', 'model_key'))
        || trim(readField(row, 'id', 'id'));
    if (!id) return null;
    const label = trim(readField(row, 'displayName', 'display_name'))
        || trim(readField(row, '_displayName', '_display_name'))
        || id;
    const providerKey = trim(readField(row, 'providerKey', 'provider_key'))
        || trim(readField(row, 'owned_by', 'owned_by'))
        || 'soul-gateway';
    const providerLabel = trim(readField(row, 'providerDisplayName', 'provider_display_name')) || providerKey;
    const providerModelId = trim(readField(row, 'providerModelId', 'provider_model_id'))
        || '';
    const root = trim(readField(row, 'root', 'root')) || '';
    const tags = asArray(readField(row, '_tags', '_tags', readField(row, 'tags', 'tags', [])))
        .map((value) => trim(String(value).toLowerCase()))
        .filter(Boolean);
    const normalized = {
        id,
        label,
        providerKey,
        providerLabel,
        providerModelId,
        root,
        kind: trim(readField(row, 'kind', 'kind')),
        type: trim(readField(row, 'type', 'type')),
        providerKind: trim(readField(row, 'providerKind', 'provider_kind')),
        adapterKey: trim(readField(row, 'adapterKey', 'adapter_key')),
        backendKey: trim(readField(row, 'backendKey', 'backend_key')),
        tags,
        capabilities: normalizeObject(readField(row, 'capabilities', 'capabilities', readField(row, '_capabilities', '_capabilities', {}))),
        metadata: normalizeObject(readField(row, 'metadata', 'metadata', {})),
        enabled: readField(row, 'enabled', 'enabled', true) !== false,
    };
    normalized.isEmbedding = isEmbeddingModel(normalized);
    normalized.isSearch = isSearchModel(normalized);
    return normalized;
}

function stripProviderPrefix(value, providerKey) {
    const text = trim(value);
    const prefix = trim(providerKey);
    if (!text || !prefix) return '';
    const expected = `${prefix}/`;
    return text.startsWith(expected) ? trim(text.slice(expected.length)) : '';
}

function lastPathSegment(value) {
    const text = trim(value);
    if (!text) return '';
    const index = text.lastIndexOf('/');
    return trim(index >= 0 ? text.slice(index + 1) : text);
}

function searchProviderIdFromModel(model) {
    const metadataProvider = trim(model.metadata?.provider);
    if (trim(model.providerModelId)) return trim(model.providerModelId);
    if (metadataProvider) return metadataProvider;
    return stripProviderPrefix(model.id, model.providerKey)
        || stripProviderPrefix(model.root, model.providerKey)
        || lastPathSegment(model.root)
        || lastPathSegment(model.id);
}

function labelFromSearchProviderId(id) {
    const known = {
        duckduckgo: 'DuckDuckGo',
        searxng: 'SearXNG',
        tavily: 'Tavily',
        brave: 'Brave',
        exa: 'Exa',
        serper: 'Serper',
        jina: 'Jina',
        gemini: 'Google AI Mode',
        'gemini-search': 'Google AI Mode',
        'google-ai-mode': 'Google AI Mode',
        'deep-research': 'Deep Research',
    };
    if (known[id]) return known[id];
    return id
        .split(/[-_]+/)
        .filter(Boolean)
        .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
        .join(' ');
}

function searchProvidersFromModels(models) {
    const providersById = new Map();
    for (const model of models) {
        if (!asArray(model.tags).includes('search')) continue;
        const id = searchProviderIdFromModel(model);
        if (!id || providersById.has(id)) continue;
        const label = (
            trim(model.metadata?.displayName)
            || trim(model.metadata?.name)
            || (model.label !== model.id && model.label !== model.root ? trim(model.label) : '')
            || labelFromSearchProviderId(id)
            || id
        );
        providersById.set(id, {
            id,
            label,
            modelId: model.id,
        });
    }
    return Array.from(providersById.values())
        .sort((a, b) => a.label.localeCompare(b.label));
}

function normalizePayload(payload) {
    const rows = asArray(payload?.data);
    const models = rows
        .map(normalizeModel)
        .filter(Boolean)
        .filter((model) => model.enabled)
        .sort((a, b) => {
            const providerCmp = a.providerLabel.localeCompare(b.providerLabel);
            if (providerCmp !== 0) return providerCmp;
            return a.label.localeCompare(b.label);
        });
    const searchModels = models.filter((model) => model.isSearch);
    return {
        ok: true,
        models,
        chatModels: models.filter((model) => !model.isEmbedding && !model.isSearch),
        embeddingModels: models.filter((model) => model.isEmbedding),
        searchProviders: searchProvidersFromModels(searchModels),
    };
}

async function main() {
    const routerUrl = trim(process.env.PLOINKY_ROUTER_URL);
    const apiKey = trim(process.env.PLOINKY_AGENT_API_KEY);
    if (!routerUrl) {
        throw new Error('PLOINKY_ROUTER_URL is required to list Soul Gateway models.');
    }
    if (!apiKey) {
        throw new Error('PLOINKY_AGENT_API_KEY is required to list Soul Gateway models.');
    }

    const url = `${routerUrl.replace(/\/+$/, '')}/base-agent-additional-server/soul-gateway/7000/v1/models`;
    const response = await fetch(url, {
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
    });
    const text = await response.text();
    let payload = null;
    try {
        payload = text ? JSON.parse(text) : null;
    } catch {
        payload = null;
    }
    if (!response.ok) {
        throw new Error(`Soul Gateway models request failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    const normalized = normalizePayload(payload);
    process.stdout.write(JSON.stringify(normalized));
}

try {
    await main();
} catch (error) {
    process.stdout.write(JSON.stringify({
        ok: false,
        error: error?.message || 'Failed to list Soul Gateway models.',
    }));
}
