/**
 * Validate Skill - Validates a skill file against its schema
 *
 * Validates a skill definition file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validateSkillContent } from '../../../schemas/skillSchemas.mjs';
import { parseSingleArgInput } from '../../../lib/skillInputParser.mjs';

export async function action(invocation = {}) {
    const mainAgent = invocation.mainAgent;
    const prompt = invocation.promptText;
    const parsed = parseSingleArgInput(prompt, 'validate-skill <skillName>');
    if (parsed.error) {
        return parsed.error;
    }
    const skillName = parsed.value;

    if (!skillName) {
        return 'Error: skillName is required. Usage: validate-skill <skillName>';
    }

    // Use getSkillRecord to locate the skill
    const skillRecord = mainAgent?.getSkillRecord?.(skillName);

    if (!skillRecord) {
        return `Error: Skill "${skillName}" not found`;
    }

    let content;
    try {
        content = fs.readFileSync(skillRecord.filePath, 'utf8');
    } catch (error) {
        return `Error reading skill file: ${error.message}`;
    }

    // Validate
    const result = validateSkillContent(content);

    const output = [];
    output.push(`Validation: ${skillName}`);
    output.push(`File: ${path.basename(skillRecord.filePath)}`);
    output.push(`Detected Type: ${result.detectedType || 'unknown'}`);
    output.push(`Status: ${result.valid ? 'VALID' : 'INVALID'}`);

    if (result.errors && result.errors.length > 0) {
        output.push('\nErrors:');
        result.errors.forEach(e => output.push(`  - ${e}`));
    }

    if (result.warnings && result.warnings.length > 0) {
        output.push('\nWarnings:');
        result.warnings.forEach(w => output.push(`  - ${w}`));
    }

    if (result.valid && (!result.warnings || result.warnings.length === 0)) {
        output.push('\nNo issues found.');
    }

    return output.join('\n');
}

export default action;
