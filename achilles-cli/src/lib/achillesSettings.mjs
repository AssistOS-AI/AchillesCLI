import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { normalizePermissionMode, PERMISSION_MODES } from '../permissions/protocol.mjs';
import {
    assertSafeAchillesPrivatePath,
    ensureAchillesPrivateDataRoot,
} from './privateDataRoot.mjs';

const SETTINGS_FILE_NAME = 'settings.json';

export function getAchillesSettingsPath(workingDir = process.cwd(), options = {}) {
    return assertSafeAchillesPrivatePath(workingDir, SETTINGS_FILE_NAME, {
        ...options,
        label: 'AchillesCLI settings file',
        type: 'file',
    });
}

export function readAchillesSettings(workingDir = process.cwd()) {
    const settingsPath = getAchillesSettingsPath(workingDir);
    try {
        const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }
        const { version: _legacyVersion, ...settings } = parsed;
        return settings;
    } catch (error) {
        if (error?.code === 'ENOENT' || error instanceof SyntaxError) {
            return {};
        }
        throw error;
    }
}

export function getSelectedModel(workingDir = process.cwd()) {
    const model = readAchillesSettings(workingDir).model;
    return typeof model === 'string' && model.trim() ? model.trim() : null;
}

export function getPermissionMode(workingDir = process.cwd()) {
    return normalizePermissionMode(readAchillesSettings(workingDir).permissions)
        || PERMISSION_MODES.ASK;
}

export function getCurrentSessionId(workingDir = process.cwd()) {
    const sessionId = readAchillesSettings(workingDir).currentSessionId;
    return typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : null;
}

export function getDisabledSkills(workingDir = process.cwd()) {
    const disabledSkills = readAchillesSettings(workingDir).disabledSkills;
    if (!Array.isArray(disabledSkills)) return [];
    return [...new Set(disabledSkills
        .filter((name) => typeof name === 'string' && name.trim())
        .map((name) => name.trim()))];
}

function writeAchillesSettings(workingDir, settings) {
    ensureAchillesPrivateDataRoot(workingDir);
    const settingsPath = getAchillesSettingsPath(workingDir);
    const temporaryPath = `${settingsPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
            encoding: 'utf8',
            mode: 0o600,
            flag: 'wx',
        });
        getAchillesSettingsPath(workingDir);
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
        model,
    });
    return model;
}

export function clearSelectedModel(workingDir) {
    const settings = readAchillesSettings(workingDir);
    delete settings.model;
    writeAchillesSettings(workingDir, {
        ...settings,
    });
}

export function setPermissionMode(workingDir, mode) {
    const permissions = normalizePermissionMode(mode);
    if (!permissions) {
        throw new Error(`Use ${PERMISSION_MODES.ASK} or ${PERMISSION_MODES.FULL}.`);
    }
    const settings = readAchillesSettings(workingDir);
    writeAchillesSettings(workingDir, {
        ...settings,
        permissions,
    });
    return permissions;
}
export function setCurrentSessionId(workingDir, sessionId) {
    const currentSessionId = String(sessionId || '').trim();
    if (!currentSessionId) {
        throw new Error('A session id is required.');
    }
    const settings = readAchillesSettings(workingDir);
    writeAchillesSettings(workingDir, {
        ...settings,
        currentSessionId,
    });
    return currentSessionId;
}

export function setDisabledSkills(workingDir, skillNames) {
    if (!Array.isArray(skillNames)) {
        throw new TypeError('Disabled skill names must be an array.');
    }
    const disabledSkills = [...new Set(skillNames
        .filter((name) => typeof name === 'string' && name.trim())
        .map((name) => name.trim()))].sort();
    const settings = readAchillesSettings(workingDir);
    if (disabledSkills.length) settings.disabledSkills = disabledSkills;
    else delete settings.disabledSkills;
    writeAchillesSettings(workingDir, settings);
    return disabledSkills;
}
