/**
 * Get Template - Returns a blank template for a skill type
 */

import { SKILL_TYPES, SKILL_TEMPLATES } from '../../../schemas/skillSchemas.mjs';
import { parseSingleArgInput } from '../../../lib/skillInputParser.mjs';

export async function action(invocation = {}) {
    const mainAgent = invocation.mainAgent;
    const prompt = invocation.promptText;
    const parsed = parseSingleArgInput(prompt, 'get-template <skillType>');
    if (parsed.error) {
        return parsed.error;
    }
    const skillType = parsed.value.toLowerCase();

    const availableTypes = Object.keys(SKILL_TEMPLATES);

    if (!skillType) {
        return `Error: skillType is required.\nAvailable types: ${availableTypes.join(', ')}`;
    }

    const template = SKILL_TEMPLATES[skillType];
    if (!template) {
        return `Error: Unknown skill type "${skillType}".\nAvailable types: ${availableTypes.join(', ')}`;
    }

    const schema = SKILL_TYPES[skillType] || {};

    const output = [];
    output.push(`=== Template: ${skillType} (${schema.fileName || skillType + '.md'}) ===`);
    output.push(`Description: ${schema.description || 'No description'}`);
    output.push(`Required sections: ${(schema.requiredSections || []).join(', ') || 'None'}`);
    output.push(`Optional sections: ${(schema.optionalSections || []).join(', ') || 'None'}`);
    output.push('');
    output.push('--- TEMPLATE START ---');
    output.push(template);
    output.push('--- TEMPLATE END ---');

    return output.join('\n');
}

export default action;
