/**
 * Generate Code - Generates runtime .mjs code from tskill/dbtable and cskill definitions
 *
 * Generates code for supported skill definitions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { detectSkillType, parseSkillSections, loadSpecsContent } from '../../../schemas/skillSchemas.mjs';
import {
    buildCodeGenPrompt,
    buildCskillCodeGenPrompt,
} from '../codeGeneration.prompts.mjs';
import { runTestFile } from '../../../lib/testDiscovery.mjs';
import { formatTestResult } from '../../../ui/TestResultFormatter.mjs';
import { SKILL_TYPE_NAMES, FILE_NAMES, TIERS, RESPONSE_SHAPES } from '../../../lib/constants.mjs';
import { requestWorkspaceSkillsRefresh } from '../../../lib/workspaceSkillRefresh.mjs';
import { parseSingleArgInput } from '../../../lib/skillInputParser.mjs';

const SUPPORTED_TYPES = [SKILL_TYPE_NAMES.TSKILL, SKILL_TYPE_NAMES.CSKILL];

function parseSkillName(prompt) {
    const parsed = parseSingleArgInput(prompt, 'generate-code <skillName>');
    if (parsed.error) {
        return { error: parsed.error, skillName: null };
    }
    return { error: null, skillName: parsed.value };
}

/**
 * Check if regeneration is needed by comparing file modification times.
 * Returns true if sources are newer than the generated file.
 * @param {string} generatedPath - Path to the generated runtime file
 * @param {string[]} sourcePaths - Paths to source files.
 * @returns {{needsRegen: boolean, reason: string}}
 */
function checkNeedsRegeneration(generatedPath, sourcePaths) {
    // If generated file doesn't exist, we need to generate
    if (!fs.existsSync(generatedPath)) {
        return { needsRegen: true, reason: 'generated file does not exist' };
    }

    let generatedMtime;
    try {
        generatedMtime = fs.statSync(generatedPath).mtimeMs;
    } catch (error) {
        return { needsRegen: true, reason: 'could not stat generated file' };
    }

    // Check each source file
    for (const sourcePath of sourcePaths) {
        if (!fs.existsSync(sourcePath)) {
            continue;
        }

        try {
            const sourceMtime = fs.statSync(sourcePath).mtimeMs;
            if (sourceMtime > generatedMtime) {
                const fileName = path.basename(sourcePath);
                return { needsRegen: true, reason: `${fileName} is newer than generated file` };
            }
        } catch (error) {
            // If we can't stat a source file, assume we need to regenerate
            return { needsRegen: true, reason: `could not stat source file: ${sourcePath}` };
        }
    }

    return { needsRegen: false, reason: 'generated file is up to date' };
}

function collectSpecSourcePaths(skillDir) {
    const specsDir = path.join(skillDir, 'specs');
    const sourcePaths = [];

    if (fs.existsSync(specsDir)) {
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
                    queue.push(entryPath);
                } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mds')) {
                    sourcePaths.push(entryPath);
                }
            }
        }
    }

    return sourcePaths;
}

function getOutputPath(skillDir, skillType) {
    if (skillType === SKILL_TYPE_NAMES.TSKILL) {
        return path.join(skillDir, 'src', FILE_NAMES.TSKILL_GENERATED);
    }
    if (skillType === SKILL_TYPE_NAMES.CSKILL) {
        return path.join(skillDir, 'src', 'index.mjs');
    }
    return null;
}

export async function action(invocation = {}) {
    const mainAgent = invocation.mainAgent;
    const prompt = invocation.promptText;
    // Get llmAgent from the mainAgent
    const llmAgent = mainAgent?.llmAgent;

    const parsedSkillName = parseSkillName(prompt);
    if (parsedSkillName.error) {
        return parsedSkillName.error;
    }
    const skillName = parsedSkillName.skillName;

    if (!skillName) {
        return 'Error: skillName is required. Usage: generate-code <skillName>';
    }

    // Use getSkillRecord to locate the skill
    const skillRecord = mainAgent?.getSkillRecord?.(skillName);

    if (!skillRecord) {
        return `Error: Skill "${skillName}" not found`;
    }

    const filePath = skillRecord.filePath;
    const skillDir = skillRecord.skillDir || path.dirname(filePath);

    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        return `Error reading skill file: ${error.message}`;
    }

    // Verify it's a supported type
    const skillType = detectSkillType(content);
    if (!SUPPORTED_TYPES.includes(skillType)) {
        return `Error: Code generation is only supported for: ${SUPPORTED_TYPES.join(', ')}.\nThis skill is type: ${skillType || 'unknown'}`;
    }

    const outPath = getOutputPath(skillDir, skillType);
    const outFileName = path.relative(skillDir, outPath);

    // Build list of source files to check (skill definition + optional specs)
    const sourcePaths = [filePath, ...collectSpecSourcePaths(skillDir)];

    // Check if regeneration is needed based on file timestamps
    const { needsRegen, reason } = checkNeedsRegeneration(outPath, sourcePaths);
    if (!needsRegen) {
        return `Skipped: ${outFileName} is up to date (no source files modified since last generation)`;
    }

    if (!llmAgent || typeof llmAgent.executePrompt !== 'function') {
        return 'Error: LLM agent not available for code generation';
    }

    // Parse sections for context
    const sections = parseSkillSections(content);

    // Load specs content if available
    const specsContent = loadSpecsContent(skillDir);

    // Generate code using LLM with appropriate prompt based on skill type
    let codeGenPrompt;
    switch (skillType) {
        case SKILL_TYPE_NAMES.TSKILL:
            codeGenPrompt = buildCodeGenPrompt(skillName, content, sections, specsContent);
            break;
        case SKILL_TYPE_NAMES.CSKILL:
            codeGenPrompt = buildCskillCodeGenPrompt(skillName, content, sections, specsContent);
            break;
        default:
            return `Error: No code generation prompt for skill type: ${skillType}`;
    }

    try {
        let generatedCode = await llmAgent.executePrompt(codeGenPrompt, {
            responseShape: RESPONSE_SHAPES.CODE,
            model: TIERS.CODE,
        });

        // Clean up response - remove markdown code blocks if present
        if (typeof generatedCode === 'string') {
            generatedCode = generatedCode
                .replace(/^```(?:javascript|js|mjs)?\n?/i, '')
                .replace(/\n?```$/i, '')
                .trim();
        }

        if (!generatedCode || typeof generatedCode !== 'string') {
            return 'Error: LLM returned empty or invalid code';
        }

        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, generatedCode, 'utf8');
        requestWorkspaceSkillsRefresh(mainAgent, {
            operation: 'generate-code',
            skillName,
            filePath: outPath,
        });

        const outputLines = [
            `Generated: ${outFileName}`,
            `Path: ${outPath}`,
            `Size: ${generatedCode.length} bytes`,
        ];

        // Auto-run tests from the tests folder in the working directory
        const workingDir = mainAgent?.startDir || process.cwd();
        const testsDir = path.join(workingDir, 'tests');

        // Look for test files matching the skill name
        const testPatterns = [
            path.join(testsDir, `${skillName}.test.mjs`),
            path.join(testsDir, `${skillName}.tests.mjs`),
        ];

        const testFile = testPatterns.find(f => fs.existsSync(f));

        if (testFile) {
            outputLines.push('');
            outputLines.push(`[Auto-running tests from ${path.relative(workingDir, testFile)}...]`);

            try {
                const testResult = await runTestFile(testFile, {
                    timeout: 30000,
                    verbose: false,
                });

                // Add skill info to result for formatting
                const fullResult = {
                    skillName,
                    skillType,
                    ...testResult,
                };

                outputLines.push(formatTestResult(fullResult));
            } catch (testError) {
                outputLines.push(`Test error: ${testError.message}`);
            }
        } else {
            outputLines.push('');
            outputLines.push(`No test file found for "${skillName}" in tests/ folder.`);
        }

        return outputLines.join('\n');
    } catch (error) {
        return `Error generating code: ${error.message}`;
    }
}

export default action;
