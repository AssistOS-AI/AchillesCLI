import fs from 'node:fs/promises';
import path from 'node:path';

export const SETTINGS_PATH = path.join(process.env.HOME, 'gpt-researcher-settings.json');

export const DEFAULT_SETTINGS = Object.freeze({
    fastLlm: 'fast',
    smartLlm: 'deep',
    strategicLlm: 'plan',
    embedding: 'embeddings'
});

function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function normalizeSettings(value = {}) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        fastLlm: trim(input.fastLlm) || DEFAULT_SETTINGS.fastLlm,
        smartLlm: trim(input.smartLlm) || DEFAULT_SETTINGS.smartLlm,
        strategicLlm: trim(input.strategicLlm) || DEFAULT_SETTINGS.strategicLlm,
        embedding: trim(input.embedding) || DEFAULT_SETTINGS.embedding
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
