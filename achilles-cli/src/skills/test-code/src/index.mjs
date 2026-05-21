/**
 * Test Code - Tests generated code by importing and running it
 */

import fs from 'node:fs';
import path from 'node:path';
import { parsePositionalInput } from '../../../lib/skillInputParser.mjs';

export async function action(invocation = {}) {
    const mainAgent = invocation.mainAgent;
    const prompt = invocation.promptText;
    const usage = 'test-code <skillName> [--begin-input--\\n<testInput>\\n--end-input--]';
    const parsed = parsePositionalInput(prompt, {
        usage,
        minArgs: 1,
        block: true,
    });
    if (parsed.error) {
        return parsed.error;
    }

    const skillName = parsed.args[0];
    const restInput = parsed.args.slice(1).join(' ');
    const testInput = parsed.content !== null
        ? parsed.content
        : restInput || undefined;

    if (!skillName) {
        return `Error: skillName is required. Usage: ${usage}`;
    }

    // Use getSkillRecord to get skill directory
    const skillRecord = mainAgent?.getSkillRecord?.(skillName);
    const skillDir = skillRecord?.skillDir;

    if (!skillDir || !fs.existsSync(skillDir)) {
        return `Error: Skill directory not found for "${skillName}"`;
    }

    const candidateFiles = [
        path.join(skillDir, 'src', 'index.mjs'),
        path.join(skillDir, 'src', 'index.js'),
        path.join(skillDir, 'src', 'tskill.generated.mjs'),
    ];
    const fullPath = candidateFiles.find((candidate) => fs.existsSync(candidate));

    if (!fullPath) {
        return `Error: No runtime code found for "${skillName}".\nExpected one of: ${candidateFiles.join(', ')}`;
    }

    const generatedFile = path.relative(skillDir, fullPath);

    try {
        // Add timestamp to bust cache
        const moduleUrl = `file://${fullPath}?t=${Date.now()}`;
        const module = await import(moduleUrl);

        const output = [];
        output.push(`Module loaded: ${generatedFile}`);
        output.push('');
        output.push('Exports:');

        const results = [];

        for (const [name, value] of Object.entries(module)) {
            if (name === 'default') continue;

            const type = typeof value;
            if (type === 'function') {
                output.push(`  - ${name}(): function`);

                // Try to execute with test input if provided
                if (testInput !== undefined) {
                    try {
                        const result = await value(testInput);
                        const resultStr = typeof result === 'string'
                            ? result
                            : JSON.stringify(result);
                        const preview = resultStr.length > 100
                            ? resultStr.slice(0, 100) + '...'
                            : resultStr;
                        results.push(`    ${name}(testInput) = ${preview}`);
                    } catch (e) {
                        results.push(`    ${name}(testInput) ERROR: ${e.message}`);
                    }
                }
            } else {
                output.push(`  - ${name}: ${type}`);
            }
        }

        if (results.length > 0) {
            output.push('');
            output.push('Test Results:');
            output.push(...results);
        }

        return output.join('\n');
    } catch (error) {
        return [
            `Failed to load module: ${error.message}`,
            '',
            'This usually means there is a syntax error in the generated code.',
            'Check the generated file or regenerate it.',
            '',
            'Stack trace:',
            error.stack,
        ].join('\n');
    }
}

export default action;
