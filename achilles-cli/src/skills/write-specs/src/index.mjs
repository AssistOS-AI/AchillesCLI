/**
 * Write Specs - Creates or updates a skill's specs/ specification file
 *
 * Writes or updates a skill's specs/ file.
 */

import fs from 'node:fs';
import path from 'node:path';
import { requestWorkspaceSkillsRefresh } from '../../../lib/workspaceSkillRefresh.mjs';
import { parsePositionalInput } from '../../../lib/skillInputParser.mjs';

/**
 * Generate a basic specs template for a skill
 */
function generateSpecsTemplate(skillName, skillType) {
    const entityName = skillName.replace(/-skill.*$/, '').replace(/-tskill$/, '').toLowerCase();

    if (skillType === 'tskill') {
        return `# ${skillName} - Technical Specification

## Overview

The **${skillName}** skill is a database table skill (tskill) that manages ${entityName} records.

## Skill Type

- **Type**: \`tskill\` (Table Skill / Database Table Skill)
- **Generated File**: \`src/tskill.generated.mjs\`
- **Definition File**: \`tskill.md\`

## Purpose

[Describe the purpose of this skill]

## Schema Definition

### Primary Key

| Field | Format | Description |
|-------|--------|-------------|
| \`${entityName}_id\` | \`PREFIX-####\` | Auto-generated unique identifier |

### Core Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| \`${entityName}_id\` | String | Yes | Primary key |
| \`name\` | String | Yes | Display name |
| \`created_at\` | DateTime | Yes | Creation timestamp |

## Code Generation Prompt

Generate JavaScript/ESM code for this database table skill.

### Skill Info
- Skill Name: {{skillName}}
- Entity: ${entityName}
- Primary Key Field: ${entityName}_id

### Skill Definition
{{content}}

### Required Function Signatures

#### 1. generatePKValues(record, existingRecords)
\`\`\`javascript
export function generatePKValues(record, existingRecords = []) {
    if (record.${entityName}_id) return {};
    const prefix = 'PREFIX-';
    let maxNum = 0;
    for (const r of existingRecords) {
        const match = (r.${entityName}_id || '').match(/PREFIX-(\\d+)/);
        if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
    }
    return { ${entityName}_id: prefix + String(maxNum + 1).padStart(4, '0') };
}
\`\`\`

#### 2. Validators Return JSON Error Strings
\`\`\`javascript
export function validator_name(value, record) {
    if (!value || typeof value !== 'string' || value.trim().length < 2) {
        return JSON.stringify({
            field: 'name',
            error: 'Name is required',
            value: value
        });
    }
    return '';
}
\`\`\`

#### 3. validateRecord Returns { isValid, errors }
\`\`\`javascript
export function validateRecord(record) {
    const errors = [];
    // Run validators and collect errors
    return { isValid: errors.length === 0, errors };
}
\`\`\`

#### 4. prepareRecord is ASYNC
\`\`\`javascript
export async function prepareRecord(record, context = {}) {
    const prepared = { ...record };
    if (!prepared.created_at) prepared.created_at = new Date().toISOString();
    prepared.updated_at = new Date().toISOString();
    return prepared;
}
\`\`\`

Generate ONLY JavaScript code, no markdown code blocks, no explanations.

## Validation Requirements

### Required Exports
- generatePKValues
- prepareRecord
- validateRecord
- validator_${entityName}_id
- validator_name

### Required Fields
- ${entityName}_id
- name
- created_at

### Custom Rules
- Validators must return JSON.stringify({ field, error, value }) or empty string
- validateRecord must return { isValid: boolean, errors: Array }
- prepareRecord must be async
`;
    }

    // Generic template for other skill types
    return `# ${skillName} - Technical Specification

## Overview

[Describe the ${skillName} skill]

## Skill Type

- **Type**: \`${skillType || 'cskill'}\`

## Purpose

[Describe the purpose of this skill]

## Implementation Details

[Add implementation details here]

## Usage Examples

[Add usage examples here]
`;
}

function getDefaultSpecFile(skillType) {
    if (skillType === 'dbtable' || skillType === 'tskill') {
        return 'tskill.generated.mjs.md';
    }
    if (skillType === 'cskill') {
        return 'index.mjs.md';
    }
    return 'notes.md';
}

function safeSpecFileName(value, skillType) {
    const requested = String(value || getDefaultSpecFile(skillType)).trim();
    const normalized = requested
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/^specs\//, '');
    if (!normalized || normalized.includes('..')) {
        return getDefaultSpecFile(skillType);
    }
    return normalized.endsWith('.md') || normalized.endsWith('.mds')
        ? normalized
        : `${normalized}.md`;
}

export async function action(invocation = {}) {
    const mainAgent = invocation.mainAgent;
    const prompt = invocation.promptText;
    // Derive skills directory from startDir
    const startDir = mainAgent?.startDir;
    if (!startDir) {
        return 'Error: startDir not available';
    }

    const skillsDir = path.join(startDir, 'skills');

    const usage = 'write-specs <skillName> [fileName] --begin-content--\\n<content>\\n--end-content--';
    const parsed = parsePositionalInput(prompt, {
        usage,
        minArgs: 1,
        maxArgs: 2,
        block: true,
    });
    if (parsed.error) {
        return parsed.error;
    }

    const [skillName, requestedSpecFile] = parsed.args;
    const content = parsed.content;
    const generateTemplate = content === null && !requestedSpecFile;

    if (!skillName) {
        return 'Error: skillName is required';
    }

    // Find the skill to get its directory
    const skillRecord = mainAgent?.getSkillRecord?.(skillName);

    let skillDir;
    if (skillRecord) {
        skillDir = skillRecord.skillDir || path.dirname(skillRecord.filePath);

    } else {
        // Skill doesn't exist yet - create in skillsDir
        skillDir = path.join(skillsDir, skillName);
    }

    const skillType = skillRecord?.type || 'cskill';
    const specFile = safeSpecFileName(requestedSpecFile, skillType);
    const specsDir = path.join(skillDir, 'specs');
    const specsPath = path.join(specsDir, specFile);

    // Handle full content write or template generation
    let finalContent = content;

    if (!finalContent && generateTemplate) {
        finalContent = generateSpecsTemplate(skillName, skillType);
    }

    if (!finalContent) {
        return `Error: content is required. Use ${usage}, or write-specs <skillName> to generate a template.`;
    }

    try {
        // Create directory if needed
        fs.mkdirSync(specsDir, { recursive: true });

        const existed = fs.existsSync(specsPath);
        fs.writeFileSync(specsPath, finalContent, 'utf8');
        requestWorkspaceSkillsRefresh(mainAgent, {
            operation: 'write-specs',
            skillName,
            filePath: specsPath,
        });

        const action = existed ? 'Updated' : 'Created';
        return `${action}: ${skillName}/specs/${specFile} (${finalContent.length} bytes)\nPath: ${specsPath}`;
    } catch (error) {
        return `Error writing specs file: ${error.message}`;
    }
}

export default action;
