import path from 'node:path';

import { getDisabledSkills, setDisabledSkills } from './achillesSettings.mjs';

const TYPE_LABELS = Object.freeze({
    cskill: 'cskill',
    'dynamic-code-generation': 'dcgskill',
    orchestrator: 'oskill',
    dbtable: 'tskill',
});

function isInside(candidate, root) {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function toRelativePath(candidate, workingDir) {
    return path.relative(path.resolve(workingDir), path.resolve(candidate)).split(path.sep).join('/');
}

export function getWorkspaceSkillRecords(agent, workingDir) {
    const root = path.resolve(workingDir);
    return agent.getSkills()
        .filter((skill) => skill?.skillDir && !skill.isInternal && isInside(skill.skillDir, root))
        .sort((left, right) => {
            const pathOrder = toRelativePath(left.skillDir, root).localeCompare(toRelativePath(right.skillDir, root));
            return pathOrder || left.name.localeCompare(right.name);
        });
}

export function createWorkspaceSkillsSnapshot(agent, workingDir) {
    return getWorkspaceSkillRecords(agent, workingDir).map((skill) => ({
        name: skill.name,
        displayName: skill.shortName || path.basename(skill.skillDir),
        relativePath: toRelativePath(skill.skillDir, workingDir),
        type: TYPE_LABELS[skill.type] || skill.type,
        enabled: skill.enabled !== false,
    }));
}

export function applyPersistedWorkspaceSkillState(agent, workingDir) {
    const workspaceNames = new Set(getWorkspaceSkillRecords(agent, workingDir).map((skill) => skill.name));
    const disabled = getDisabledSkills(workingDir).filter((name) => workspaceNames.has(name));
    if (disabled.length) agent.disableSkills(disabled);
    return createWorkspaceSkillsSnapshot(agent, workingDir);
}

export function setWorkspaceSkillEnabled(agent, workingDir, identifier, enabled) {
    const record = agent.getSkillRecord(String(identifier || '').trim());
    const workspaceNames = new Set(getWorkspaceSkillRecords(agent, workingDir).map((skill) => skill.name));
    if (!record || !workspaceNames.has(record.name)) {
        throw new Error(`Workspace skill "${identifier}" not found.`);
    }
    return setWorkspaceSkillNamesEnabled(agent, workingDir, [record.name], enabled);
}

export function setWorkspaceDirectoryEnabled(agent, workingDir, relativeDirectory, enabled) {
    const raw = String(relativeDirectory || '').trim();
    if (!raw || raw.includes('\0') || path.isAbsolute(raw)) {
        throw new Error('A relative workspace directory is required.');
    }
    const root = path.resolve(workingDir);
    const directory = path.resolve(root, raw);
    if (!isInside(directory, root)) {
        throw new Error('Skill directory must stay inside the working directory.');
    }
    const names = getWorkspaceSkillRecords(agent, root)
        .filter((skill) => isInside(skill.skillDir, directory))
        .map((skill) => skill.name);
    if (!names.length) {
        throw new Error(`No registered skills found under "${raw}".`);
    }
    return setWorkspaceSkillNamesEnabled(agent, root, names, enabled);
}

function setWorkspaceSkillNamesEnabled(agent, workingDir, names, enabled) {
    const previous = new Set(getDisabledSkills(workingDir));
    if (enabled) agent.enableSkills(names);
    else agent.disableSkills(names);

    const next = new Set(previous);
    for (const name of names) {
        if (enabled) next.delete(name);
        else next.add(name);
    }
    try {
        setDisabledSkills(workingDir, [...next].sort());
    } catch (error) {
        if (enabled) agent.disableSkills(names);
        else agent.enableSkills(names);
        throw error;
    }
    return createWorkspaceSkillsSnapshot(agent, workingDir);
}

export function createWebchatSkillsEnvelope(skills, { event = 'list', operation = null, error = '' } = {}) {
    return {
        __webchatSkills: 1,
        version: 1,
        event,
        skills,
        ...(operation ? { operation } : {}),
        ...(error ? { error: String(error) } : {}),
    };
}

export function emitWebchatSkillsEnvelope(envelope, { write } = {}) {
    const output = typeof write === 'function' ? write : (value) => process.stdout.write(value);
    output(`${JSON.stringify(envelope)}\n`);
    return envelope;
}

export function formatWorkspaceSkills(skills) {
    if (!skills.length) return 'No registered workspace skills.';
    return skills.map((skill) => {
        const marker = skill.enabled ? 'enabled' : 'disabled';
        return `${skill.relativePath} (${skill.type}) [${marker}]`;
    }).join('\n');
}
