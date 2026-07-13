#!/usr/bin/env node

import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OPENCODE_BIN } from '../scripts/opencode-runner.mjs';

const MODEL_LIST_TIMEOUT_MS = 30000;
const DEFAULT_TAGS = ['coding', 'agentic'];
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

function stripAnsi(value) {
    return String(value || '').replace(ANSI_PATTERN, '');
}

function isModelIdLine(line) {
    return /^[^\s{}:"']+\/[^\s{}:"']+$/.test(stripAnsi(line).trim());
}

function parseJsonIfComplete(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

export function parseVerboseModels(output) {
    const records = [];
    const lines = String(output || '').split(/\r?\n/);
    let currentModelId = '';
    let jsonBuffer = '';

    for (const line of lines) {
        const cleanLine = stripAnsi(line);
        const trimmed = cleanLine.trim();

        if (!jsonBuffer && isModelIdLine(trimmed)) {
            currentModelId = trimmed;
            continue;
        }

        if (!jsonBuffer && !trimmed.startsWith('{')) {
            continue;
        }

        jsonBuffer += `${cleanLine}\n`;
        const parsed = parseJsonIfComplete(jsonBuffer);
        if (!parsed) {
            continue;
        }

        const fullId = currentModelId || [parsed.providerID, parsed.id].filter(Boolean).join('/');
        if (fullId) {
            records.push({ fullId, details: parsed });
        }
        currentModelId = '';
        jsonBuffer = '';
    }

    return records;
}

export function parseSimpleModelIds(output) {
    return String(output || '')
        .split(/\r?\n/)
        .map((line) => stripAnsi(line).trim())
        .filter(isModelIdLine)
        .map((fullId) => ({ fullId, details: null }));
}

function parseOptionalNumber(value) {
    if (value === null || typeof value === 'undefined') {
        return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function pricingForModel(details) {
    const inputPricePerMillion = parseOptionalNumber(details?.cost?.input);
    const outputPricePerMillion = parseOptionalNumber(details?.cost?.output);
    const hasPricing = inputPricePerMillion !== null || outputPricePerMillion !== null;

    if (!hasPricing) {
        return {
            pricingMode: 'external_directory',
            inputPricePerMillion: null,
            outputPricePerMillion: null,
            isFree: false,
        };
    }

    const free = (inputPricePerMillion ?? 0) === 0 && (outputPricePerMillion ?? 0) === 0;
    return {
        pricingMode: free ? 'free' : 'token',
        inputPricePerMillion,
        outputPricePerMillion,
        isFree: free,
    };
}

export function opencodeModelDescriptor(record) {
    const fullId = String(record?.fullId || '').trim();
    const details = record?.details || {};
    const slashIndex = fullId.indexOf('/');
    const provider = slashIndex > 0 ? fullId.slice(0, slashIndex) : details.providerID || '';
    const providerModelId = fullId;
    const pricing = pricingForModel(details);
    const inputCapabilities = details.capabilities?.input || {};

    return {
        id: providerModelId,
        object: 'model',
        modelId: providerModelId,
        providerModelId,
        displayName: details.name || providerModelId,
        contextWindow: parseOptionalNumber(details.limit?.context),
        maxOutputTokens: parseOptionalNumber(details.limit?.output),
        supportsTools: Boolean(details.capabilities?.toolcall),
        supportsStreaming: false,
        supportsVision: Boolean(inputCapabilities.image || inputCapabilities.pdf || inputCapabilities.video),
        pricing: {
            mode: pricing.pricingMode,
            inputPricePerMillion: pricing.inputPricePerMillion,
            outputPricePerMillion: pricing.outputPricePerMillion,
        },
        pricingMode: pricing.pricingMode,
        inputPricePerMillion: pricing.inputPricePerMillion,
        outputPricePerMillion: pricing.outputPricePerMillion,
        isFree: pricing.isFree,
        tags: DEFAULT_TAGS,
        capabilities: {
            coding: true,
            agentic: true,
            supportsTools: Boolean(details.capabilities?.toolcall),
            supportsStreaming: false,
            supportsVision: Boolean(inputCapabilities.image || inputCapabilities.pdf || inputCapabilities.video),
            contextWindow: parseOptionalNumber(details.limit?.context),
            maxOutputTokens: parseOptionalNumber(details.limit?.output),
        },
        metadata: {
            opencodeProvider: provider || null,
            opencodeModelId: details.id || (slashIndex > 0 ? fullId.slice(slashIndex + 1) : fullId),
            opencodeFamily: details.family || null,
            opencodeStatus: details.status || null,
            opencodeApi: details.api || null,
            opencodeCapabilities: details.capabilities || null,
            opencodeLimits: details.limit || null,
        },
    };
}

function runOpenCodeModels(args, {
    env = process.env,
    timeoutMs = MODEL_LIST_TIMEOUT_MS,
} = {}) {
    const opencodeBin = env.OPENCODE_BIN || DEFAULT_OPENCODE_BIN;

    return new Promise((resolve, reject) => {
        const child = spawn(opencodeBin, ['models', ...args], {
            env: {
                ...process.env,
                ...env,
                HOME: env.HOME || '/root',
                NO_COLOR: '1',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            try {
                child.kill('SIGTERM');
            } catch {
            }
        }, timeoutMs);

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        child.on('close', (code, signal) => {
            clearTimeout(timeout);
            if (code === 0 && !timedOut) {
                resolve(stdout);
                return;
            }
            const detail = stderr.trim() || stdout.trim();
            reject(new Error(`opencode models failed with exit code ${code ?? 'unknown'}${signal ? ` signal ${signal}` : ''}${timedOut ? ' after timeout' : ''}${detail ? `: ${detail}` : ''}`));
        });
    });
}

export async function listOpenCodeModels(options = {}) {
    const verboseOutput = await runOpenCodeModels(['--verbose'], options);
    const verboseRecords = parseVerboseModels(verboseOutput);
    if (verboseRecords.length > 0) {
        return verboseRecords.map(opencodeModelDescriptor);
    }

    const simpleOutput = await runOpenCodeModels([], options);
    return parseSimpleModelIds(simpleOutput).map(opencodeModelDescriptor);
}

async function main() {
    const models = await listOpenCodeModels();
    process.stdout.write(JSON.stringify({
        object: 'list',
        data: models,
    }));
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
    main().catch((error) => {
        process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
        process.exitCode = 1;
    });
}
