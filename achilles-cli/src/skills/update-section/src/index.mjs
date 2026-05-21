/**
 * Update Section - Updates a specific section in a skill definition file
 * Automatically triggers code regeneration if a generated runtime file exists
 *
 * Updates skill definitions and regenerates code if needed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { updateSkillSection } from '../../../schemas/skillSchemas.mjs';
import { requestWorkspaceSkillsRefresh } from '../../../lib/workspaceSkillRefresh.mjs';
import { parsePositionalInput } from '../../../lib/skillInputParser.mjs';

/**
 * Check if a generated runtime file exists in the skill directory
 */
function hasGeneratedCode(skillDir) {
    if (!skillDir || !fs.existsSync(skillDir)) return false;
    return [
        path.join(skillDir, 'src', 'tskill.generated.mjs'),
        path.join(skillDir, 'src', 'index.mjs'),
        path.join(skillDir, 'src', 'index.js'),
    ].some((candidate) => fs.existsSync(candidate));
}

/**
 * Trigger code regeneration for the skill
 */
async function triggerCodeRegeneration(skillName, mainAgent) {
    try {
        // Dynamically import generate-code to avoid circular dependencies
        const generateCodeModule = await import('../../generate-code/src/index.mjs');
        const generateAction = generateCodeModule.action || generateCodeModule.default;

        if (typeof generateAction === 'function') {
            const result = await generateAction({ mainAgent, promptText: skillName });
            return { success: true, result };
        }
        return { success: false, error: 'generate-code action not found' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

export async function action(invocation = {}) {
    const mainAgent = invocation.mainAgent;
    const prompt = invocation.promptText;
    const usage = 'update-section <skillName> <section> --begin-content--\\n<content>\\n--end-content--';
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

    const [skillName, section] = parsed.args;
    const newContent = parsed.content;

    if (!skillName) {
        return 'Error: skillName is required';
    }
    if (!section) {
        return 'Error: section is required (e.g., "Description", "Instructions")';
    }
    if (newContent === undefined || newContent === null) {
        return `Error: content is required. Usage: ${usage}`;
    }

    // Use getSkillRecord to locate the skill
    const skillRecord = mainAgent?.getSkillRecord?.(skillName);

    if (!skillRecord) {
        return `Error: Skill "${skillName}" not found`;
    }

    const filePath = skillRecord.filePath;
    const skillDir = skillRecord.skillDir || path.dirname(filePath);

    let currentContent;
    try {
        currentContent = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        return `Error reading skill file: ${error.message}`;
    }

    // Update section
    const updatedContent = updateSkillSection(currentContent, section, newContent);

    try {
        fs.writeFileSync(filePath, updatedContent, 'utf8');
        requestWorkspaceSkillsRefresh(mainAgent, {
            operation: 'update-section',
            skillName,
            filePath,
        });

        const messages = [`Updated section "## ${section}" in ${skillName}`];

        // Check if code regeneration is needed
        if (['dbtable', 'tskill', 'cskill'].includes(skillRecord.type) && hasGeneratedCode(skillDir)) {
            messages.push('');
            messages.push('Detected existing generated code. Triggering regeneration...');

            const regenResult = await triggerCodeRegeneration(skillName, mainAgent);

            if (regenResult.success) {
                messages.push(`Code regenerated successfully.`);
                if (typeof regenResult.result === 'string' && regenResult.result.includes('Generated:')) {
                    // Extract just the relevant info
                    const match = regenResult.result.match(/Generated: (.+\.(?:mjs|js))/);
                    if (match) {
                        messages.push(`Output: ${match[1]}`);
                    }
                }
            } else {
                messages.push(`Warning: Code regeneration failed: ${regenResult.error}`);
                messages.push('You may need to run "generate code" manually.');
            }
        }

        messages.push('');
        messages.push('Remember to reload skills after changes.');

        return messages.join('\n');
    } catch (error) {
        return `Error writing file: ${error.message}`;
    }
}

export default action;
