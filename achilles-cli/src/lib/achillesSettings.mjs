import fs from 'node:fs';
import path from 'node:path';

const SETTINGS_VERSION = 1;
const SETTINGS_FILE_NAME = 'settings.json';

export function getAchillesSettingsPath(workingDir = process.cwd()) {
    return path.join(path.resolve(workingDir), '.achilles-cli', SETTINGS_FILE_NAME);
}

export function readAchillesSettings(workingDir = process.cwd()) {
    const settingsPath = getAchillesSettingsPath(workingDir);
    try {
        const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { version: SETTINGS_VERSION };
        }
        return {
            ...parsed,
            version: SETTINGS_VERSION,
        };
    } catch (error) {
        if (error?.code === 'ENOENT' || error instanceof SyntaxError) {
            return { version: SETTINGS_VERSION };
        }
        throw error;
    }
}

export function getSelectedModel(workingDir = process.cwd()) {
    const model = readAchillesSettings(workingDir).model;
    return typeof model === 'string' && model.trim() ? model.trim() : null;
}

function writeAchillesSettings(workingDir, settings) {
    const settingsPath = getAchillesSettingsPath(workingDir);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const temporaryPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
            encoding: 'utf8',
            mode: 0o600,
        });
        fs.renameSync(temporaryPath, settingsPath);
    } finally {
        try {
            fs.unlinkSync(temporaryPath);
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
    }
}

export function setSelectedModel(workingDir, modelName) {
    const model = String(modelName || '').trim();
    if (!model) {
        throw new Error('A model name is required.');
    }
    const settings = readAchillesSettings(workingDir);
    writeAchillesSettings(workingDir, {
        ...settings,
        version: SETTINGS_VERSION,
        model,
    });
    return model;
}

export function clearSelectedModel(workingDir) {
    const settings = readAchillesSettings(workingDir);
    delete settings.model;
    writeAchillesSettings(workingDir, {
        ...settings,
        version: SETTINGS_VERSION,
    });
}
