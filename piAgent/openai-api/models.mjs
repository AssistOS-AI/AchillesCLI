#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPiModelRuntime } from '../scripts/pi-model-runtime.mjs';


function parseCompactNumber(value) {
    const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)([KM])?$/i);
    if (!match) return null;
    const multiplier = match[2]?.toUpperCase() === 'M'
        ? 1000000
        : (match[2]?.toUpperCase() === 'K' ? 1000 : 1);
    return Math.round(Number(match[1]) * multiplier);
}

export function parsePiModelsTable(output) {
    const lines = String(output || '').split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2 || !/^provider\s+model\s+/i.test(lines[0].trim())) return [];
    return lines.slice(1).map((line) => {
        const columns = line.trim().split(/\s{2,}/);
        if (columns.length < 2) return null;
        const [provider, model, context = '', maxOutput = '', thinking = '', images = ''] = columns;
        if (!provider || !model) return null;
        const id = `${provider}/${model}`;
        return {
            id,
            object: 'model',
            modelId: model,
            providerModelId: id,
            displayName: model,
            contextWindow: parseCompactNumber(context),
            maxOutputTokens: parseCompactNumber(maxOutput),
            supportsTools: true,
            supportsStreaming: false,
            supportsVision: images.toLowerCase() === 'yes',
            tags: ['coding-agent'],
            metadata: {
                piProvider: provider,
                piModelId: model,
                supportsThinking: thinking.toLowerCase() === 'yes',
            },
            execution: { provider, model },
        };
    }).filter(Boolean);
}

export async function listPiModels({ env = process.env } = {}) {
    const runtime = await createPiModelRuntime(env);
    const models = await runtime.getAvailable();
    return models.map((model) => ({
        id: `${model.provider}/${model.id}`,
        object: 'model',
        modelId: model.id,
        providerModelId: `${model.provider}/${model.id}`,
        displayName: model.name || model.id,
        contextWindow: Number.isFinite(Number(model.contextWindow)) ? Number(model.contextWindow) : null,
        maxOutputTokens: Number.isFinite(Number(model.maxTokens)) ? Number(model.maxTokens) : null,
        supportsTools: true,
        supportsStreaming: false,
        supportsVision: Array.isArray(model.input) && model.input.includes('image'),
        tags: ['coding-agent'],
        metadata: {
            piProvider: model.provider,
            piModelId: model.id,
            supportsThinking: model.reasoning === true,
        },
        execution: { provider: model.provider, model: model.id },
    }));
}

async function main() {
    process.stdout.write(JSON.stringify({ object: 'list', data: await listPiModels() }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        process.stderr.write(`${error?.stack || error}\n`);
        process.exitCode = 1;
    });
}
