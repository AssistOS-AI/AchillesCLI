import path from 'node:path';

const INTRO_SKILL_SHORT_NAME = 'intro-skill';
const INTRO_SKILL_CANONICAL_NAME = 'intro-skill-cskill';
const MAX_SKILLS_FOR_INTRO = 30;

function cleanText(value, maxLength = 260) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function getSkillDescription(skillRecord) {
    const sections = skillRecord?.descriptor?.sections || {};
    return cleanText(
        sections.description
        || sections.summary
        || skillRecord?.descriptor?.summary
        || skillRecord?.descriptor?.name
        || ''
    );
}

function isHiddenFromMainSession(agent, skillRecord) {
    const hidden = agent?._orchestratorAllowedSkills;
    if (!hidden || typeof hidden.has !== 'function') {
        return false;
    }
    return hidden.has(skillRecord.name) || hidden.has(skillRecord.shortName);
}

function isIntroSkill(skillRecord) {
    return skillRecord?.shortName === INTRO_SKILL_SHORT_NAME
        || skillRecord?.name === INTRO_SKILL_SHORT_NAME
        || skillRecord?.name === INTRO_SKILL_CANONICAL_NAME;
}

function normalizeSkillRecord(skillRecord) {
    return {
        name: skillRecord.name,
        shortName: skillRecord.shortName || skillRecord.name,
        type: skillRecord.type || 'skill',
        description: getSkillDescription(skillRecord),
    };
}

export function buildIntroSkillPayload(agent, { workingDir } = {}) {
    const safeWorkingDir = workingDir || agent?.startDir || process.cwd();
    const skills = typeof agent?.getSkills === 'function'
        ? agent.getSkills()
            .filter((skillRecord) => !isIntroSkill(skillRecord))
            .filter((skillRecord) => !isHiddenFromMainSession(agent, skillRecord))
            .map(normalizeSkillRecord)
            .slice(0, MAX_SKILLS_FOR_INTRO)
        : [];

    return {
        workingDir: safeWorkingDir,
        workspaceName: path.basename(safeWorkingDir) || safeWorkingDir,
        skills,
    };
}

function extractSkillResultText(result) {
    const value = result?.result ?? result;
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value.trim();
    }
    if (typeof value.output === 'string') {
        return value.output.trim();
    }
    return '';
}

export function shouldStartWebchatIntro(env = process.env) {
    return String(env?.PLOINKY_WEBCHAT_HAS_HISTORY || '').trim() !== '1';
}

export function startWebchatIntroSkill(agent, options = {}) {
    const { env = process.env, ...introOptions } = options;
    if (!shouldStartWebchatIntro(env)) {
        return null;
    }
    return startIntroSkill(agent, introOptions);
}

export function startIntroSkill(agent, options = {}) {
    const skillRecord = agent?.getSkillRecord?.(INTRO_SKILL_SHORT_NAME)
        || agent?.getSkillRecord?.(INTRO_SKILL_CANONICAL_NAME);
    if (!skillRecord || typeof agent?.executeSkill !== 'function') {
        return null;
    }

    const {
        workingDir,
        context = {},
        logger = agent.logger,
        onStart = null,
        write = async (message) => {
            process.stdout.write(message);
        },
    } = options;

    const payload = buildIntroSkillPayload(agent, { workingDir });
    const task = Promise.resolve().then(async () => {
        if (typeof onStart === 'function') {
            await onStart(payload);
        }
        const result = await agent.executeSkill(skillRecord.name, JSON.stringify(payload), {
            context: {
                ...context,
                introStartup: true,
            }
        });
        const text = extractSkillResultText(result);
        if (!text) {
            return null;
        }
        await write(text.endsWith('\n') ? text : `${text}\n`);
        return text;
    }).catch((error) => {
        logger?.debug?.(`[AchillesCli] intro-skill failed: ${error?.message || error}`);
        return null;
    });

    return task;
}
