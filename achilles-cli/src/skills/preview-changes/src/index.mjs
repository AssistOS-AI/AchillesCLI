/**
 * Preview Changes - Shows a diff before applying changes
 */

import fs from 'node:fs';
import path from 'node:path';
import { parsePositionalInput } from '../../../lib/skillInputParser.mjs';

/**
 * Simple diff implementation
 */
function simpleDiff(oldText, newText) {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const diff = [];

    let i = 0, j = 0;
    while (i < oldLines.length || j < newLines.length) {
        if (i >= oldLines.length) {
            diff.push(`+ ${newLines[j]}`);
            j++;
        } else if (j >= newLines.length) {
            diff.push(`- ${oldLines[i]}`);
            i++;
        } else if (oldLines[i] === newLines[j]) {
            diff.push(`  ${oldLines[i]}`);
            i++;
            j++;
        } else {
            const oldInNew = newLines.indexOf(oldLines[i], j);
            const newInOld = oldLines.indexOf(newLines[j], i);

            if (oldInNew === -1 && newInOld === -1) {
                diff.push(`- ${oldLines[i]}`);
                diff.push(`+ ${newLines[j]}`);
                i++;
                j++;
            } else if (oldInNew === -1 || (newInOld !== -1 && newInOld < oldInNew)) {
                diff.push(`- ${oldLines[i]}`);
                i++;
            } else {
                diff.push(`+ ${newLines[j]}`);
                j++;
            }
        }
    }

    return diff.join('\n');
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

    const usage = 'preview-changes <skillName> <fileName> --begin-content--\\n<newContent>\\n--end-content--';
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
    const newContent = parsed.content;

    if (!skillName) {
        return 'Error: skillName is required';
    }
    if (!fileName) {
        return 'Error: fileName is required';
    }
    if (!newContent) {
        return `Error: newContent is required. Usage: ${usage}`;
    }

    const filePath = path.join(skillsDir, skillName, fileName);

    // If file doesn't exist, show as new file
    if (!fs.existsSync(filePath)) {
        return [
            `=== NEW FILE: ${skillName}/${fileName} ===`,
            '',
            newContent,
        ].join('\n');
    }

    let currentContent;
    try {
        currentContent = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        return `Error reading file: ${error.message}`;
    }

    // Check if content is identical
    if (currentContent === newContent) {
        return `No changes detected in ${skillName}/${fileName}`;
    }

    const diff = simpleDiff(currentContent, newContent);

    return [
        `=== DIFF: ${skillName}/${fileName} ===`,
        '(- removed, + added)',
        '',
        diff,
    ].join('\n');
}

export default action;
