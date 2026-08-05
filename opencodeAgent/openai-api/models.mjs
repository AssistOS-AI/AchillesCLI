import { runOpenCodeOperation } from '../scripts/opencode-runner.mjs';

const DEFAULT_TAGS = ['coding-agent'];
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
const SILENT_LOG_STREAM = Object.freeze({ write() {} });

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
        execution: { model: providerModelId },
    };
}

async function runOpenCodeModels(args, {
    env = process.env,
    providerRuntime,
    logStream,
} = {}) {
    const result = await runOpenCodeOperation({
        args: ['models', ...args],
        env,
        providerRuntime,
        logStream,
    });
    if (result.code !== 0 || result.signal) {
        const error = new Error(
            `OpenCode models failed (${result.signal
                ? `signal ${result.signal}`
                : `exit ${result.code ?? 'unknown'}`})`,
        );
        error.code = 'PLOINKY_PROVIDER_OPERATION_FAILED';
        throw error;
    }
    return result.stdoutTail;
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

export async function listOpenCodeModelsEndpoint(_payload, { providerRuntime } = {}) {
    try {
        const models = await listOpenCodeModels({
            providerRuntime,
            logStream: SILENT_LOG_STREAM,
        });
        return {
            ok: true,
            response: {
                object: 'list',
                data: models,
            },
        };
    } catch (error) {
        if (error?.code === 'PLOINKY_PROVIDER_RUNTIME_REQUIRED') throw error;
        return {
            ok: false,
            code: error?.code || 'PLOINKY_PROVIDER_OPERATION_FAILED',
            error: error?.message || 'OpenCode models failed',
        };
    }
}
