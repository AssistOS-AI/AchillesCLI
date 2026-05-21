/**
 * Run Tests Skill
 *
 * Discovers and runs tests for skills. Supports per-skill tests
 * (.tests.mjs files) and running all discovered tests.
 */

import {
    discoverSkillTests,
    discoverSkillTest,
    runTestFile,
    runTestSuite,
} from '../../../lib/testDiscovery.mjs';
import {
    formatSuiteResults,
    formatTestResult,
    formatTestList,
} from '../../../ui/TestResultFormatter.mjs';
import { parsePositionalInput } from '../../../lib/skillInputParser.mjs';

/**
 * Parse input to extract target and options
 */
function parseInput(prompt) {
    const parsed = parsePositionalInput(prompt || '', {
        usage: 'run-tests [target] [verbose] [timeoutMs]',
        maxArgs: 3,
    });
    if (parsed.error) {
        return { target: null, options: {}, error: parsed.error };
    }

    const options = {};
    for (const arg of parsed.args.slice(1)) {
        if (arg === 'verbose') {
            options.verbose = true;
        } else if (/^\d+$/.test(arg)) {
            options.timeout = Number(arg);
        }
    }

    return { target: parsed.args[0] || null, options, error: null };
}

/**
 * Main action function
 */
export async function action(invocation = {}) {
    const mainAgent = invocation.mainAgent;
    const prompt = invocation.promptText;
    const { target, options, error } = parseInput(prompt);
    if (error) {
        return error;
    }

    // If no target, list available tests
    if (!target) {
        const tests = discoverSkillTests(mainAgent);

        if (tests.length === 0) {
            return 'No tests found. Create .tests.mjs files in skill directories to add tests.';
        }

        const lines = [
            'Available tests:',
            '',
            ...tests.map((t) => `  • ${t.shortName || t.skillName} [${t.skillType}]`),
            '',
            `Found ${tests.length} test(s). Use /test <skill-name> or /test all to run.`,
        ];

        return lines.join('\n');
    }

    // Run all tests
    if (target.toLowerCase() === 'all') {
        const tests = discoverSkillTests(mainAgent);

        if (tests.length === 0) {
            return 'No tests found. Create .tests.mjs files in skill directories to add tests.';
        }

        console.log(`\nRunning ${tests.length} test(s)...\n`);

        const suiteResult = await runTestSuite(tests, {
            timeout: options.timeout || 30000,
            verbose: options.verbose || false,
        });

        return formatSuiteResults(suiteResult);
    }

    // Run tests for specific skill
    const testInfo = discoverSkillTest(mainAgent, target);

    if (!testInfo) {
        // Check if skill exists but has no tests
        const skillRecord = mainAgent?.getSkillRecord?.(target);

        if (skillRecord) {
            return `Skill "${target}" found but has no .tests.mjs file.\n\nCreate a test file at:\n  ${skillRecord.skillDir || 'skill-dir'}/.tests.mjs`;
        }

        return `Skill "${target}" not found. Use /test to see available tests.`;
    }

    console.log(`\nRunning tests for ${testInfo.skillName}...\n`);

    const result = await runTestFile(testInfo.testFile, {
        timeout: options.timeout || 30000,
        verbose: options.verbose || false,
    });

    // Add skill info to result
    const fullResult = {
        ...testInfo,
        ...result,
    };

    return formatTestResult(fullResult);
}

/**
 * Get list of available tests for interactive selection
 */
export function getAvailableTests(mainAgent) {
    const tests = discoverSkillTests(mainAgent);
    return formatTestList(tests);
}

export default action;
