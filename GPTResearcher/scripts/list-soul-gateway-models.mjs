#!/usr/bin/env node

function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function asObject(value) {
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

function isEmbeddingModel(model) {
    const capabilities = asObject(model.capabilities);
    const tags = asArray(model.tags);
    if (
        capabilities.supportsEmbeddings === true ||
        capabilities.supportsEmbedding === true ||
        capabilities.embeddings === true ||
        capabilities.embedding === true
    ) {
        return true;
    }
    const haystack = lowerWords(model.id, model.label, model.providerModelId, tags, capabilities);
    return /\b(embed|embedding|embeddings)\b/.test(haystack) || haystack.includes('text-embedding');
}

function normalizeModel(row) {
    const id = trim(readField(row, 'modelKey', 'model_key'))
        || trim(readField(row, 'id', 'id'));
    if (!id) return null;
    const label = id;
    const providerKey = trim(readField(row, 'providerKey', 'provider_key'))
        || trim(readField(row, 'owned_by', 'owned_by'))
        || 'soul-gateway';
    const providerLabel = trim(readField(row, 'providerDisplayName', 'provider_display_name')) || providerKey;
    const providerModelId = trim(readField(row, 'providerModelId', 'provider_model_id'))
        || trim(readField(row, 'root', 'root'))
        || '';
    const tags = asArray(readField(row, '_tags', '_tags', readField(row, 'tags', 'tags', [])));
    const capabilities = asObject(readField(row, 'capabilities', 'capabilities', {}));
    const context = asObject(readField(row, '_context', '_context', {}));
    const normalized = {
        id,
        label,
        providerKey,
        providerLabel,
        providerModelId,
        tags,
        capabilities: {
            ...capabilities,
            contextWindow: capabilities.contextWindow ?? context.window ?? null,
            maxOutputTokens: capabilities.maxOutputTokens ?? context.max_output_tokens ?? null,
        },
        enabled: readField(row, 'enabled', 'enabled', true) !== false,
    };
    normalized.isEmbedding = isEmbeddingModel(normalized);
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
        chatModels: models.filter((model) => !model.isEmbedding),
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
