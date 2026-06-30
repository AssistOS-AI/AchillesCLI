import fs from 'node:fs/promises';
import path from 'node:path';

export const SETTINGS_PATH = path.join(process.env.WORKSPACE_PATH, 'gpt-researcher-settings.json');

export const DEFAULT_SETTINGS = Object.freeze({
    fastLlm: 'ollama:llama3.1',
    smartLlm: 'ollama:llama3.1',
    strategicLlm: 'ollama:llama3.1',
    embedding: 'ollama:nomic-embed-text',
    retriever: 'duckduckgo',
    env: Object.freeze({
        OLLAMA_BASE_URL: 'http://host.containers.internal:11434',
        OPENAI_BASE_URL: '',
        AZURE_OPENAI_ENDPOINT: '',
        AZURE_OPENAI_API_VERSION: '',
        MISTRAL_BASE_URL: '',
        OPENROUTER_LIMIT_RPS: '',
        VLLM_OPENAI_API_BASE: '',
        AIMLAPI_BASE_URL: ''
    })
});

export const ALLOWED_ENV_KEYS = Object.freeze(new Set(Object.keys(DEFAULT_SETTINGS.env)));

function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeEnv(value = {}) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const env = {};
    for (const key of ALLOWED_ENV_KEYS) {
        env[key] = trim(input[key] ?? DEFAULT_SETTINGS.env[key]);
    }
    return env;
}

export function normalizeSettings(value = {}) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        fastLlm: trim(input.fastLlm) || DEFAULT_SETTINGS.fastLlm,
        smartLlm: trim(input.smartLlm) || DEFAULT_SETTINGS.smartLlm,
        strategicLlm: trim(input.strategicLlm) || DEFAULT_SETTINGS.strategicLlm,
        embedding: trim(input.embedding) || DEFAULT_SETTINGS.embedding,
        retriever: trim(input.retriever) || DEFAULT_SETTINGS.retriever,
        env: normalizeEnv(input.env)
    };
}

export async function readSettings() {
    try {
        const raw = await fs.readFile(SETTINGS_PATH, 'utf8');
        return normalizeSettings(JSON.parse(raw));
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return normalizeSettings();
        }
        throw error;
    }
}

export async function writeSettings(settings) {
    const normalized = normalizeSettings(settings);
    await fs.mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
    const tempPath = `${SETTINGS_PATH}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`);
    await fs.rename(tempPath, SETTINGS_PATH);
    return normalized;
}

export async function readStdinJson() {
    if (process.stdin.isTTY) {
        return {};
    }
    process.stdin.setEncoding('utf8');
    let data = '';
    for await (const chunk of process.stdin) {
        data += chunk;
    }
    const text = data.trim();
    if (!text) {
        return {};
    }
    const parsed = JSON.parse(text);
    return parsed?.input && typeof parsed.input === 'object' ? parsed.input : parsed;
}
