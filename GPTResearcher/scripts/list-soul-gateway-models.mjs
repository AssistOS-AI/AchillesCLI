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
    'gemini-search',
    'google-ai-mode',
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
        tags.includes('retrieval') ||
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
    const haystack = lowerWords(
        model.id,
        model.label,
        model.providerModelId,
        tags
    );
    return haystack.includes('search-')
        || haystack.includes('deep-research')
        || haystack.includes('headless-')
        || /\b(search|retrieval|grounding)\b/.test(haystack);
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
        || trim(readField(row, 'root', 'root'))
        || '';
    const tags = asArray(readField(row, '_tags', '_tags', readField(row, 'tags', 'tags', [])));
    const normalized = {
        id,
        label,
        providerKey,
        providerLabel,
        providerModelId,
        kind: trim(readField(row, 'kind', 'kind')),
        type: trim(readField(row, 'type', 'type')),
        providerKind: trim(readField(row, 'providerKind', 'provider_kind')),
        adapterKey: trim(readField(row, 'adapterKey', 'adapter_key')),
        backendKey: trim(readField(row, 'backendKey', 'backend_key')),
        tags,
        capabilities: {},
        enabled: readField(row, 'enabled', 'enabled', true) !== false,
    };
    normalized.isEmbedding = isEmbeddingModel(normalized);
    normalized.isSearch = isSearchModel(normalized);
    return normalized;
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
    return {
        ok: true,
        models,
        chatModels: models.filter((model) => !model.isEmbedding && !model.isSearch),
        embeddingModels: models.filter((model) => model.isEmbedding),
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

    const url = `${routerUrl.replace(/\/+$/, '')}/services/soul-gateway/v1/models`;
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
    process.stdout.write(JSON.stringify(normalizePayload(payload)));
}

try {
    await main();
} catch (error) {
    process.stdout.write(JSON.stringify({
        ok: false,
        error: error?.message || 'Failed to list Soul Gateway models.',
    }));
}
