/**
 * Read Skill - Reads a skill definition file
 *
 * Reads any registered skill definition.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseSingleArgInput } from '../../../lib/skillInputParser.mjs';

export async function action(invocation = {}) {
    const mainAgent = invocation.mainAgent;
    const prompt = invocation.promptText;
    const parsed = parseSingleArgInput(prompt, 'read-skill <skillName>');
    if (parsed.error) {
        return parsed.error;
    }
    const skillName = parsed.value;

    if (!skillName) {
        return 'Error: skillName is required. Usage: read-skill <skillName>';
    }

    // Use getSkillRecord to locate the skill
    const skillRecord = mainAgent?.getSkillRecord?.(skillName);

    if (!skillRecord) {
        // List available skills
        const userSkills = mainAgent?.getSkills?.().filter(s => !s.isInternal) || [];
        const available = userSkills.map(s => s.shortName || s.name).join(', ');
        return `Error: Skill "${skillName}" not found.\nAvailable skills: ${available || 'none'}`;
    }

    try {
        const content = fs.readFileSync(skillRecord.filePath, 'utf8');

        return `=== ${path.basename(skillRecord.filePath)} ===\nPath: ${skillRecord.filePath}\nType: ${skillRecord.type}\n\n${content}`;
    } catch (error) {
        return `Error reading skill file: ${error.message}`;
    }
}

export default action;
