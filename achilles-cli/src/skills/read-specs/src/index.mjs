/**
 * Read Specs - Reads a skill's specs/ specification files
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseSingleArgInput } from '../../../lib/skillInputParser.mjs';

function collectSpecFiles(specsDir) {
    const files = [];
    const queue = [specsDir];
    while (queue.length > 0) {
        const current = queue.shift();
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== '.backup') {
                    queue.push(entryPath);
                }
            } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mds')) {
                files.push(entryPath);
            }
        }
    }
    return files.sort();
}

export async function action(invocation = {}) {
    const mainAgent = invocation.mainAgent;
    const prompt = invocation.promptText;
    const parsed = parseSingleArgInput(prompt, 'read-specs <skillName>');
    if (parsed.error) {
        return parsed.error;
    }
    const skillName = parsed.value;

    if (!skillName) {
        return 'Error: skillName is required. Usage: read-specs <skillName>';
    }

    // Use getSkillRecord to locate the skill
    const skillRecord = mainAgent?.getSkillRecord?.(skillName);

    if (!skillRecord) {
        // List available skills
        const userSkills = mainAgent?.getSkills?.().filter(s => !s.isInternal) || [];
        const available = userSkills.map(s => s.shortName || s.name).join(', ');
        return `Error: Skill "${skillName}" not found.\nAvailable skills: ${available || 'none'}`;
    }

    const skillDir = skillRecord.skillDir || path.dirname(skillRecord.filePath);
    const specsDir = path.join(skillDir, 'specs');

    if (!fs.existsSync(specsDir) || !fs.statSync(specsDir).isDirectory()) {
        return `No specs/ directory found for skill "${skillName}".\nExpected path: ${specsDir}\n\nTo create one, use: /specs-write ${skillName}`;
    }

    try {
        const specFiles = collectSpecFiles(specsDir);
        if (specFiles.length === 0) {
            return `No specs files found for skill "${skillName}".\nExpected markdown files under: ${specsDir}`;
        }

        const blocks = specFiles.map((filePath) => {
            const relPath = path.relative(skillDir, filePath);
            const content = fs.readFileSync(filePath, 'utf8');
            const sections = [];
            const sectionMatches = content.matchAll(/^##\s+(.+)$/gm);
            for (const match of sectionMatches) {
                sections.push(match[1]);
            }
            const sectionsInfo = sections.length > 0
                ? `\nSections: ${sections.join(', ')}`
                : '';
            return `=== ${relPath} for ${skillName} ===${sectionsInfo}\nPath: ${filePath}\n\n${content}`;
        });

        return blocks.join('\n\n---\n\n');
    } catch (error) {
        return `Error reading specs file: ${error.message}`;
    }
}

export default action;
