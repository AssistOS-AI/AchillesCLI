/**
 * List Skills - Returns all registered skills from the catalog
 *
 * By default, only shows user skills (excludes internal).
 *
 * Use "list all skills" to include internal skills.
 */

import { isJsonLikeInput, rejectJsonInput } from '../../../lib/skillInputParser.mjs';

export async function action(invocation = {}) {
    const mainAgent = invocation.mainAgent;
    const prompt = invocation.promptText;
    if (!mainAgent || typeof mainAgent.getSkills !== 'function') {
        return 'Error: No skill catalog available';
    }

    // Parse filter from input
    let filter = null;
    let showAllSkills = false;

    // Phrases that should NOT be treated as filters
    const ignorePatterns = [
        'list skills', 'list all skills', 'show skills', 'show all skills',
        'get skills', 'skills', 'all', 'all skills', 'list', 'show',
    ];

    // Check if user wants all skills (including internal)
    const allSkillPatterns = [
        'list all skills', 'show all skills', 'all', 'all skills',
    ];

    // If input looks like a full command/sentence (has spaces and multiple words), ignore it as a filter
    const looksLikeCommand = (str) => {
        const words = str.split(/\s+/).length;
        return words > 3 || str.includes('"') || str.includes("'");
    };

    if (typeof prompt === 'string' && prompt.trim()) {
        if (isJsonLikeInput(prompt)) {
            return rejectJsonInput('list-skills [filter|all]');
        }
        const trimmed = prompt.trim().toLowerCase();
        // Check if user explicitly wants all skills
        if (allSkillPatterns.includes(trimmed)) {
            showAllSkills = true;
        }
        // Only use as filter if it's not a common command phrase or full command
        else if (!ignorePatterns.includes(trimmed) && !looksLikeCommand(trimmed)) {
            filter = trimmed;
        }
    } else if (prompt && typeof prompt === 'object') {
        return 'Error: object input is no longer supported. Use positional syntax: list-skills [filter|all]';
    }

    // Get user skills only (exclude internal) unless explicitly requested all
    let skills = showAllSkills
        ? mainAgent.getSkills()
        : mainAgent.getSkills().filter(s => !s.isInternal);

    if (skills.length === 0) {
        return showAllSkills
            ? 'No skills currently registered. Create one with write-skill or use get-template.'
            : 'No user skills found. Create one with write-skill or use get-template.';
    }

    // Apply filter if provided
    const filtered = filter
        ? skills.filter(s => s.type === filter || s.type.includes(filter))
        : skills;

    if (filtered.length === 0) {
        return `No skills found matching filter: "${filter}"\nAvailable types: ${[...new Set(skills.map(s => s.type))].join(', ')}`;
    }

    // Format output
    const output = filtered.map(s => {
        const descriptorSections = s.descriptor?.sections || {};
        let label = 'Description';
        let description = descriptorSections.description || '';
        if (s.type === 'dbtable') {
            label = 'Table Purpose';
            description = descriptorSections['table-purpose'] || description;
        } else if (s.type === 'anthropic') {
            label = 'Overview';
            description = descriptorSections.overview || descriptorSections.description || s.descriptor?.summary || '';
        }
        return [
            `[${s.type}] ${s.shortName || s.name}`,
            `   ${label}: ${description || 'Not specified'}`,
            `   Path: ${s.skillDir || 'unknown'}`,
        ].join('\n');
    });

    const skillsLabel = showAllSkills ? 'skill(s)' : 'user skill(s)';
    const header = filter
        ? `Found ${filtered.length} ${skillsLabel} matching "${filter}":`
        : `Found ${filtered.length} ${skillsLabel}:`;

    return `${header}\n\n${output.join('\n\n')}`;
}

export default action;
