/**
 * Delete Skill - Removes a skill directory
 */

import fs from 'node:fs';
import path from 'node:path';
import { requestWorkspaceSkillsRefresh } from '../../../lib/workspaceSkillRefresh.mjs';
import { parseSingleArgInput } from '../../../lib/skillInputParser.mjs';

export async function action(invocation = {}) {
    const mainAgent = invocation.mainAgent;
    const prompt = invocation.promptText;
    // Derive skills directory from startDir
    const startDir = mainAgent?.startDir;
    if (!startDir) {
        return 'Error: startDir not available';
    }

    const skillsDir = path.join(startDir, 'skills');

    const parsed = parseSingleArgInput(prompt, 'delete-skill <skillName>');
    if (parsed.error) {
        return parsed.error;
    }
    const skillName = parsed.value;

    if (!skillName) {
        return 'Error: skillName is required. Usage: delete-skill <skillName>';
    }

    const skillDir = path.join(skillsDir, skillName);

    if (!fs.existsSync(skillDir)) {
        return `Error: Skill "${skillName}" not found at ${skillDir}`;
    }

    // List files that will be deleted
    let files = [];
    try {
        files = fs.readdirSync(skillDir);
    } catch (error) {
        return `Error reading skill directory: ${error.message}`;
    }

    try {
        fs.rmSync(skillDir, { recursive: true, force: true });
        requestWorkspaceSkillsRefresh(mainAgent, {
            operation: 'delete-skill',
            skillName,
            filePath: skillDir,
        });
        return `Deleted skill: ${skillName}\nRemoved ${files.length} file(s): ${files.join(', ')}\n\nRemember to reload skills after deletion.`;
    } catch (error) {
        return `Error deleting skill: ${error.message}`;
    }
}

export default action;
