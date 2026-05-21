/**
 * Write Skill - Creates or updates a skill definition file
 */

import fs from 'node:fs';
import path from 'node:path';
import { SKILL_FILE_NAMES } from '../../../lib/constants.mjs';
import { requestWorkspaceSkillsRefresh } from '../../../lib/workspaceSkillRefresh.mjs';
import { parsePositionalInput } from '../../../lib/skillInputParser.mjs';

export async function action(invocation = {}) {
    const mainAgent = invocation.mainAgent;
    const prompt = invocation.promptText;
    // Derive skills directory from startDir
    const startDir = mainAgent?.startDir;
    if (!startDir) {
        return 'Error: startDir not available';
    }

    const skillsDir = path.join(startDir, 'skills');

    const usage = 'write-skill <skillName> <fileName> --begin-content--\\n<content>\\n--end-content--';
    const parsed = parsePositionalInput(prompt, {
        usage,
        minArgs: 2,
        maxArgs: 2,
        block: true,
        blockRequired: true,
    });
    if (parsed.error) {
        return parsed.error;
    }

    const [skillName, fileName] = parsed.args;
    const content = parsed.content;

    if (!skillName) {
        return 'Error: skillName is required';
    }
    if (!fileName) {
        return 'Error: fileName is required (e.g., cskill.md, tskill.md, oskill.md)';
    }
    if (content === undefined || content === null) {
        return `Error: content is required. Usage: ${usage}`;
    }

    // Validate fileName
    const isSkillFile = SKILL_FILE_NAMES.includes(fileName) || fileName.endsWith('.mjs') || fileName.endsWith('.js');
    if (!isSkillFile) {
        return `Warning: "${fileName}" is not a standard skill file. Valid skill files: ${SKILL_FILE_NAMES.join(', ')}`;
    }

    const skillDir = path.join(skillsDir, skillName);
    const filePath = path.join(skillDir, fileName);

    try {
        // Create directory if needed
        if (!fs.existsSync(skillDir)) {
            fs.mkdirSync(skillDir, { recursive: true });
        }

        // Check if file exists (for messaging)
        const existed = fs.existsSync(filePath);

        // Write file
        fs.writeFileSync(filePath, content, 'utf8');
        requestWorkspaceSkillsRefresh(mainAgent, {
            operation: 'write-skill',
            skillName,
            filePath,
        });

        const action = existed ? 'Updated' : 'Created';

        return `${action}: ${skillName}/${fileName} (${content.length} bytes)\nRun /build to generate pending skills.`;
    } catch (error) {
        return `Error writing file: ${error.message}`;
    }
}

export default action;
