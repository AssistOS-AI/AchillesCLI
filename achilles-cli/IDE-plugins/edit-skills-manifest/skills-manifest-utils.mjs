export const SKILLS_MANIFEST_FILE = 'ploinky-skills-manifest.json';
export const PRECONFIGURED_SKILL_REPOSITORIES = Object.freeze([
    {
        label: 'Achilles Copilot Basic Skills',
        url: 'https://github.com/AssistOS-AI/AchillesCopilotBasicSkills.git'
    }
]);

const GIT_REMOTE_PATTERNS = [
    /^(?:https?|ssh|git):\/\/\S+$/i,
    /^git@[^:\s]+:[^\s]+$/i
];

export function buildSkillsManifestPath(folderPath) {
    const normalized = String(folderPath || '').trim().replace(/\/+$/, '');
    if (!normalized) {
        return '';
    }
    return `${normalized}/${SKILLS_MANIFEST_FILE}`;
}

export function isMissingManifestError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('enoent')
        || message.includes('no such file')
        || message.includes('not found')
        || message.includes('does not exist');
}

export function parseSkillsManifest(rawContent) {
    const parsed = JSON.parse(String(rawContent || '[]'));
    if (!Array.isArray(parsed)) {
        throw new Error('Invalid skills manifest: expected a JSON array of repository URLs.');
    }

    return parsed.map((entry, index) => {
        if (typeof entry !== 'string') {
            throw new Error(`Invalid skills manifest: entry ${index + 1} must be a string.`);
        }
        const trimmed = entry.trim();
        if (!trimmed) {
            throw new Error(`Invalid skills manifest: entry ${index + 1} is empty.`);
        }
        return trimmed;
    });
}

export function serializeSkillsManifest(repositories) {
    const normalized = Array.isArray(repositories)
        ? repositories.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [];
    return `${JSON.stringify(normalized, null, 2)}\n`;
}

export function validateRepositoryUrl(value, existingRepositories = []) {
    const url = String(value || '').trim();
    if (!url) {
        return { ok: false, error: 'Repository URL is required.', value: '' };
    }
    if (!GIT_REMOTE_PATTERNS.some((pattern) => pattern.test(url))) {
        return { ok: false, error: 'Enter a valid git URL.', value: url };
    }
    const existing = Array.isArray(existingRepositories) ? existingRepositories : [];
    if (existing.includes(url)) {
        return { ok: false, error: 'This repository is already in the manifest.', value: url };
    }
    return { ok: true, value: url };
}
