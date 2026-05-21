/**
 * SlashCommandHandler - Manages slash command definitions and execution.
 *
 * All commands start with /. Commands with subOptions show a sub-menu
 * when selected (e.g., /list → skills, repos). Commands without
 * subOptions complete directly.
 */

import { formatSlashResult } from '../ui/ResultFormatter.mjs';
import { showHelp, getQuickReference } from '../ui/HelpSystem.mjs';
import { BUILT_IN_SKILLS, getAllSkillTypeNames, DOC_SCAFFOLD_TYPES } from '../lib/constants.mjs';

// Import tier/model utilities from achillesAgentLib
let _listTiersFromCache = null;
let _listModelsFromCache = null;
try {
    const llmClient = await import('achillesAgentLib/utils/LLMClient.mjs');
    _listTiersFromCache = llmClient.listTiersFromCache;
    _listModelsFromCache = llmClient.listModelsFromCache;
} catch {
    // achillesAgentLib not available
}

/**
 * Slash command definitions.
 *
 * Commands with `subOptions` show a sub-menu when selected.
 * Commands with `skill` execute that skill directly.
 * Commands with neither are handled specially in executeSlashCommand.
 */
export const COMMAND_DEFINITIONS = {
    // Hierarchical commands with sub-options
    'list': {
        subOptions: ['skills', 'repos'],
        description: 'List items',
    },
    'add': {
        subOptions: ['repo'],
        description: 'Add items',
    },
    'remove': {
        subOptions: ['repo', 'skill'],
        description: 'Remove items',
    },

    // Direct skill commands
    'read': {
        skill: BUILT_IN_SKILLS.READ,
        usage: '/read <skill-name>',
        description: 'Read a skill definition file',
        args: 'required',
        needsSkillArg: true,
    },
    'write': {
        skill: BUILT_IN_SKILLS.WRITE,
        usage: '/write <skill-name> [type]',
        description: 'Create or update a skill file',
        args: 'required',
        needsSkillArg: true,
    },
    'delete': {
        skill: BUILT_IN_SKILLS.DELETE,
        usage: '/delete <skill-name>',
        description: 'Delete a skill directory',
        args: 'required',
        needsSkillArg: true,
    },
    'validate': {
        skill: BUILT_IN_SKILLS.VALIDATE,
        usage: '/validate <skill-name>',
        description: 'Validate skill against schema',
        args: 'required',
        needsSkillArg: true,
    },
    'template': {
        skill: BUILT_IN_SKILLS.GET_TEMPLATE,
        usage: '/template <type>',
        description: 'Get blank template (tskill, cskill, dcgskill, anthropic, etc.)',
        args: 'required',
        needsSkillArg: false,
    },
    'generate': {
        skill: BUILT_IN_SKILLS.GENERATE_CODE,
        usage: '/generate <skill-name>',
        description: 'Generate runtime code for tskill/dbtable or cskill',
        args: 'required',
        needsSkillArg: true,
    },
    'build': {
        skill: null,
        usage: '/build',
        description: 'Build pending skills from specs',
        args: 'optional',
        needsSkillArg: false,
    },
    'test': {
        skill: null,
        usage: '/test [skill-name]',
        description: 'Test skill code (shows picker if no skill specified)',
        args: 'optional',
        needsSkillArg: false,
    },
    'run-tests': {
        skill: BUILT_IN_SKILLS.RUN_TESTS,
        usage: '/run-tests [skill-name|all]',
        description: 'Run .tests.mjs files (all = run all tests)',
        args: 'optional',
        needsSkillArg: false,
    },
    'refine': {
        skill: BUILT_IN_SKILLS.SKILL_REFINER,
        usage: '/refine <skill-name>',
        description: 'Iteratively improve skill until tests pass',
        args: 'required',
        needsSkillArg: true,
    },
    'update': {
        skill: BUILT_IN_SKILLS.UPDATE_SECTION,
        usage: '/update <skill-name> <section>',
        description: 'Update a specific section of a skill',
        args: 'required',
        needsSkillArg: true,
        catalogSubOptions: ['repos'],
    },
    'exec': {
        skill: null,
        usage: '/exec <skill-name> [input]',
        description: 'Execute any skill directly',
        args: 'required',
        needsSkillArg: true,
    },
    'specs': {
        skill: BUILT_IN_SKILLS.READ_SPECS,
        usage: '/specs <skill-name>',
        description: "Read a skill's specs/ files",
        args: 'required',
        needsSkillArg: true,
    },
    'specs-write': {
        skill: BUILT_IN_SKILLS.WRITE_SPECS,
        usage: '/specs-write <skill-name> [content]',
        description: "Create/update a skill's specs/ files",
        args: 'required',
        needsSkillArg: true,
    },
    'write-tests': {
        skill: BUILT_IN_SKILLS.WRITE_TESTS,
        usage: '/write-tests <skill-name>',
        description: 'Generate test file for a skill',
        args: 'required',
        needsSkillArg: true,
    },
    'scaffold': {
        skill: BUILT_IN_SKILLS.SCAFFOLD_DOC,
        usage: '/scaffold <doc-type> <skill-name>',
        description: 'Create a documentation skill with full structure (SKILL.md + resources/ + scripts/)',
        args: 'required',
        needsSkillArg: false,
    },

    // Session commands
    'tier': {
        usage: '/tier [name]',
        description: 'Show or switch LLM tier',
        args: 'optional',
        needsSkillArg: false,
    },
    'model': {
        usage: '/model [name|clear]',
        description: 'Pin a specific model or clear pin',
        args: 'optional',
        needsSkillArg: false,
    },
    'raw': {
        usage: '/raw',
        description: 'Toggle markdown rendering',
        args: 'optional',
        needsSkillArg: false,
    },
    'help': {
        usage: '/help [topic]',
        description: 'Show help',
        args: 'optional',
        needsSkillArg: false,
    },
    'reload': {
        usage: '/reload',
        description: 'Refresh skills from disk',
        args: 'optional',
        needsSkillArg: false,
    },
    'history': {
        usage: '/history [clear|<n>|<query>]',
        description: 'Show command history',
        args: 'optional',
        needsSkillArg: false,
    },
    'exit': {
        usage: '/exit',
        description: 'Exit the REPL',
        args: 'optional',
        needsSkillArg: false,
    },
    'quit': {
        usage: '/quit',
        description: 'Exit the REPL',
        args: 'optional',
        needsSkillArg: false,
    },
};

/**
 * Sub-option definitions for hierarchical commands.
 * Each sub-option maps to a handler or skill execution.
 */
export const SUB_OPTIONS = {
    'list': {
        'skills': {
            skill: BUILT_IN_SKILLS.LIST,
            defaultInput: 'list',
            usage: '/list skills [all]',
            description: 'List skills',
            args: 'optional',
            needsSkillArg: false,
        },
        'repos': {
            skill: null,
            usage: '/list repos',
            description: 'List cloned repositories',
            args: 'optional',
            needsSkillArg: false,
        },
    },
    'add': {
        'repo': {
            skill: null,
            usage: '/add repo <URL> [name]',
            description: 'Clone a repository',
            args: 'required',
            needsSkillArg: false,
        },
    },
    'remove': {
        'repo': {
            skill: null,
            usage: '/remove repo <name>',
            description: 'Remove a cloned repository',
            args: 'required',
            needsSkillArg: false,
        },
        'skill': {
            skill: BUILT_IN_SKILLS.DELETE,
            usage: '/remove skill <skill-name>',
            description: 'Delete a skill directory',
            args: 'required',
            needsSkillArg: true,
        },
    },
    'update': {
        'repos': {
            skill: null,
            usage: '/update repos',
            description: 'Pull all cloned repositories',
            args: 'optional',
            needsSkillArg: false,
        },
    },
};

/**
 * Build a structured slash-command catalog that can be consumed by remote UIs.
 * @returns {Array<Object>}
 */
export function buildSlashCommandCatalog() {
    const catalog = [];

    for (const [name, def] of Object.entries(COMMAND_DEFINITIONS)) {
        const subDefs = SUB_OPTIONS[name] || {};
        const catalogSubOptions = [
            ...(Array.isArray(def.subOptions) ? def.subOptions : []),
            ...(Array.isArray(def.catalogSubOptions) ? def.catalogSubOptions : []),
        ];
        const subCommands = catalogSubOptions.length > 0
            ? catalogSubOptions.map((subName) => {
                const subDef = subDefs[subName] || {};
                return {
                    name: subName,
                    usage: subDef.usage || `/${name} ${subName}`,
                    description: subDef.description || '',
                    args: subDef.args || 'optional',
                    skill: subDef.skill || null,
                    needsSkillArg: Boolean(subDef.needsSkillArg),
                };
            })
            : [];

        catalog.push({
            name: `/${name}`,
            usage: def.usage || `/${name}`,
            description: def.description || '',
            args: def.args || 'optional',
            skill: def.skill || null,
            needsSkillArg: Boolean(def.needsSkillArg),
            subCommands,
        });
    }

    catalog.sort((a, b) => a.name.localeCompare(b.name));
    return catalog;
}

/**
 * SlashCommandHandler class for managing slash commands in the CLI.
 */
export class SlashCommandHandler {
    /**
     * Backwards-compatible COMMANDS alias (points to COMMAND_DEFINITIONS).
     */
    static COMMANDS = COMMAND_DEFINITIONS;

    /**
     * Static helper for callers that only need command metadata.
     * @returns {Array<Object>}
     */
    static getCommandCatalog() {
        return buildSlashCommandCatalog();
    }

    /**
     * Create a new SlashCommandHandler.
     *
     * @param {Object} options
     * @param {Function} options.executeSkill - Function to execute a skill: (skillName, input, options) => Promise
     * @param {Function} [options.buildSkills] - Function to build pending skills: () => Promise<void>
     * @param {Function} options.getUserSkills - Function to get user skills: () => Array
     * @param {Function} options.getSkills - Function to get all skills: () => Array
     * @param {HistoryManager} [options.historyManager] - Command history manager
     */
    constructor({ executeSkill, buildSkills, getUserSkills, getSkills, historyManager }) {
        this.executeSkill = executeSkill;
        this.buildSkills = buildSkills;
        this.getUserSkills = getUserSkills;
        this.getSkills = getSkills;
        this.historyManager = historyManager;
    }

    /**
     * Check if input is a slash command.
     * @param {string} input - User input
     * @returns {boolean}
     */
    isSlashCommand(input) {
        return input.startsWith('/');
    }

    /**
     * Parse a slash command into parts.
     * Returns { command, subOption, args, rawArgs }
     * - command: the top-level command (e.g., 'list')
     * - subOption: the sub-option if any (e.g., 'skills')
     * - args: remaining arguments after command and sub-option
     * - rawArgs: everything after the command name
     * @param {string} input - User input starting with /
     * @returns {{command: string, subOption: string|null, args: string, rawArgs: string}|null}
     */
    parseSlashCommand(input) {
        const match = input.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
        if (!match) return null;

        const command = match[1].toLowerCase();
        const rawArgs = match[2]?.trim() || '';

        const cmdDef = COMMAND_DEFINITIONS[command];
        if (cmdDef && cmdDef.subOptions && rawArgs) {
            const parts = rawArgs.split(/\s+/);
            const firstWord = parts[0].toLowerCase();
            if (cmdDef.subOptions.includes(firstWord)) {
                return {
                    command,
                    subOption: firstWord,
                    args: parts.slice(1).join(' ').trim(),
                    rawArgs,
                };
            }
        }
        if (cmdDef && cmdDef.catalogSubOptions && rawArgs) {
            const parts = rawArgs.split(/\s+/);
            const firstWord = parts[0].toLowerCase();
            if (cmdDef.catalogSubOptions.includes(firstWord)) {
                return {
                    command,
                    subOption: firstWord,
                    args: parts.slice(1).join(' ').trim(),
                    rawArgs,
                };
            }
        }

        return {
            command,
            subOption: null,
            args: rawArgs,
            rawArgs,
        };
    }

    /**
     * Get sub-options for a command.
     * @param {string} command - Command name
     * @returns {string[]|null}
     */
    getSubOptions(command) {
        const cmdDef = COMMAND_DEFINITIONS[command];
        return cmdDef?.subOptions || null;
    }

    /**
     * Get the definition for a sub-option.
     * @param {string} command - Command name
     * @param {string} subOption - Sub-option name
     * @returns {Object|null}
     */
    getSubOptionDef(command, subOption) {
        return SUB_OPTIONS[command]?.[subOption] || null;
    }

    /**
     * Execute a slash command.
     * @param {string} command - Command name (without /)
     * @param {string} args - Command arguments
     * @param {Object} options - Execution options
     * @returns {Promise<{handled: boolean, result?: string, error?: string}>}
     */
    async executeSlashCommand(command, args, options = {}) {
        // Parse to check for sub-options
        const parsed = this.parseSlashCommand(`/${command} ${args}`.trim());
        const subOption = parsed?.subOption;

        // Handle sub-option commands
        if (subOption) {
            return this._executeSubOption(command, subOption, parsed.args, options);
        }

        // Handle built-in commands
        if (command === 'help' || command === '?') {
            if (!args) {
                return { handled: true, showHelpPicker: true };
            }
            const helpText = showHelp(args);
            console.log(helpText);
            return { handled: true };
        }

        if (command === 'raw') {
            return { handled: true, toggleMarkdown: true };
        }

        if (command === 'tier') {
            return this._handleTierCommand(args);
        }

        if (command === 'model') {
            return this._handleModelCommand(args);
        }

        if (command === 'quit' || command === 'exit' || command === 'q') {
            return { handled: true, exitRepl: true };
        }

        if (command === 'reload') {
            return this._handleReload();
        }

        if (command === 'history') {
            return this._handleHistory(args);
        }

        // Handle direct skill commands
        const cmdDef = COMMAND_DEFINITIONS[command];
        if (!cmdDef) {
            return {
                handled: false,
                error: `Unknown command: /${command}. Type /help for available commands.`,
            };
        }

        // Check required args
        if (cmdDef.args === 'required' && !args) {
            return {
                handled: true,
                error: `Usage: ${cmdDef.usage}\n  ${cmdDef.description}`,
            };
        }

        // Handle /test specially
        if (command === 'test') {
            if (!args) {
                return { handled: true, showTestPicker: true };
            }
            try {
                const result = await this.executeSkill(BUILT_IN_SKILLS.TEST_CODE, args, options);
                return { handled: true, result: formatSlashResult(result) };
            } catch (error) {
                return { handled: true, error: error.message };
            }
        }

        // Handle /exec specially
        if (command === 'exec') {
            const match = args.match(/^(\S+)(?:\s+([\s\S]*))?$/);
            const skillName = match?.[1];
            const skillInput = match?.[2]?.trim() || skillName;
            try {
                const result = await this.executeSkill(skillName, skillInput, options);
                return { handled: true, result: formatSlashResult(result) };
            } catch (error) {
                return { handled: true, error: error.message };
            }
        }

        // Handle /run-tests specially
        if (command === 'run-tests') {
            if (!args) {
                return { handled: true, showRunTestsPicker: true };
            }
            try {
                const result = await this.executeSkill(BUILT_IN_SKILLS.RUN_TESTS, args, options);
                return { handled: true, result: formatSlashResult(result) };
            } catch (error) {
                return { handled: true, error: error.message };
            }
        }

        // Handle /build specially
        if (command === 'build') {
            if (typeof this.buildSkills !== 'function') {
                return { handled: true, error: 'Build is unavailable in this session.' };
            }
            try {
                await this.buildSkills();
                return { handled: true, result: 'Skills build complete.' };
            } catch (error) {
                return { handled: true, error: error.message };
            }
        }

        // Execute the mapped skill
        if (cmdDef.skill) {
            try {
                let input = args || '';
                if (!input && command === 'list') {
                    input = 'list';
                }
                const result = await this.executeSkill(cmdDef.skill, input, options);
                return { handled: true, result: formatSlashResult(result) };
            } catch (error) {
                return { handled: true, error: error.message };
            }
        }

        return { handled: false, error: `Unknown command: /${command}` };
    }

    /**
     * Execute a sub-option command (e.g., /list repos, /add repo).
     * @private
     */
    async _executeSubOption(command, subOption, args, options) {
        const subDef = this.getSubOptionDef(command, subOption);
        if (!subDef) {
            return { handled: false, error: `Unknown sub-command: /${command} ${subOption}` };
        }

        // Check required args
        if (subDef.args === 'required' && !args) {
            return {
                handled: true,
                error: `Usage: ${subDef.usage}\n  ${subDef.description}`,
            };
        }

        // /update repos
        if (command === 'update' && subOption === 'repos') {
            const { updateRepos } = await import('../lib/repoManager.mjs');
            try {
                const result = updateRepos();
                if (result.updated.length === 0) {
                    return { handled: true, result: 'No repositories in .achilles-cli/repos/.' };
                }
                const lines = [`Updated repositories (${result.updated.length}):`];
                for (const repo of result.updated) {
                    lines.push(`  ${repo.name}`);
                }
                return { handled: true, result: lines.join('\n') };
            } catch (error) {
                return { handled: true, error: error.message };
            }
        }

        // /list repos
        if (command === 'list' && subOption === 'repos') {
            const { listRepos } = await import('../lib/repoManager.mjs');
            try {
                const repos = listRepos();
                if (repos.length === 0) {
                    return { handled: true, result: 'No repositories in .achilles-cli/repos/.' };
                }
                const lines = [`Repositories (${repos.length}):`, ''];
                for (const repo of repos) {
                    const url = repo.url || '(no remote)';
                    lines.push(`  ${repo.name}`);
                    lines.push(`    URL: ${url}`);
                    lines.push(`    Path: ${repo.path}`);
                    lines.push('');
                }
                return { handled: true, result: lines.join('\n') };
            } catch (error) {
                return { handled: true, error: error.message };
            }
        }

        // /add repo
        if (command === 'add' && subOption === 'repo') {
            const { addRepo } = await import('../lib/repoManager.mjs');
            const parts = args.split(/\s+/);
            const url = parts[0];
            const name = parts[1];
            if (!url) {
                return { handled: true, error: `Usage: /add repo <URL> [name]\n  Clone a repository into .achilles-cli/repos/` };
            }
            try {
                const result = addRepo(url, name);
                return { handled: true, result: `Repository '${result.name}' ${result.status}.\n  Path: ${result.path}` };
            } catch (error) {
                return { handled: true, error: error.message };
            }
        }

        // /remove repo
        if (command === 'remove' && subOption === 'repo') {
            const { removeRepo } = await import('../lib/repoManager.mjs');
            const name = args.trim();
            if (!name) {
                return { handled: true, error: `Usage: /remove repo <name>\n  Remove a cloned repository from .achilles-cli/repos/` };
            }
            try {
                removeRepo(name);
                return { handled: true, result: `Repository '${name}' removed.` };
            } catch (error) {
                return { handled: true, error: error.message };
            }
        }

        // Any sub-option mapped to a skill should execute that skill directly.
        if (subDef.skill) {
            try {
                const input = args || subDef.defaultInput || '';
                const result = await this.executeSkill(subDef.skill, input, options);
                return { handled: true, result: formatSlashResult(result) };
            } catch (error) {
                return { handled: true, error: error.message };
            }
        }

        return { handled: false, error: `Unhandled sub-command: /${command} ${subOption}` };
    }

    /**
     * Handle /reload command.
     * @private
     */
    _handleReload() {
        // Reload is handled by REPLSession
        return { handled: true, reloadSkills: true };
    }

    /**
     * Handle /history command.
     * @private
     */
    _handleHistory(args) {
        if (!this.historyManager) {
            return { handled: true, error: 'History manager not available.' };
        }

        if (!args) {
            return { handled: true, showHistory: true };
        }

        if (args === 'clear') {
            this.historyManager.clear();
            return { handled: true, result: 'History cleared.' };
        }

        if (/^\d+$/.test(args)) {
            return { handled: true, showHistoryCount: parseInt(args, 10) };
        }

        return { handled: true, searchHistory: args };
    }

    /**
     * Get available tier names from achillesAgentLib cache.
     * @returns {string[]}
     */
    getAvailableTiers() {
        try {
            const tiers = _listTiersFromCache?.();
            return tiers ? Object.keys(tiers) : [];
        } catch {
            return [];
        }
    }

    /**
     * Get available model names from achillesAgentLib cache.
     * @returns {string[]}
     */
    getAvailableModels() {
        try {
            const tiers = _listTiersFromCache?.();
            if (!tiers) return [];
            const seen = new Set();
            for (const models of Object.values(tiers)) {
                for (const m of models) seen.add(m);
            }
            return [...seen];
        } catch {
            return [];
        }
    }

    /**
     * Handle /tier command.
     * @private
     */
    _handleTierCommand(args) {
        const tiers = _listTiersFromCache?.();
        if (!tiers) {
            return { handled: true, error: 'Could not load tiers — achillesAgentLib not available' };
        }
        const tierNames = Object.keys(tiers);
        if (!args) {
            return { handled: true, showTierPicker: true };
        }
        const requested = args.trim().toLowerCase();
        if (!tierNames.includes(requested)) {
            return { handled: true, error: `Unknown tier "${requested}". Available: ${tierNames.join(', ')}` };
        }
        return { handled: true, tierChange: requested };
    }

    /**
     * Handle /model command.
     * @private
     */
    _handleModelCommand(args) {
        const tiers = _listTiersFromCache?.();
        if (!tiers) {
            return { handled: true, error: 'Could not load models — achillesAgentLib not available' };
        }
        if (!args) {
            return { handled: true, showModelPicker: true };
        }
        const requested = args.trim();
        if (requested.toLowerCase() === 'clear') {
            return { handled: true, modelChange: null };
        }
        const allModels = new Set();
        for (const models of Object.values(tiers)) {
            for (const m of models) allModels.add(m);
        }
        if (!allModels.has(requested)) {
            return { handled: true, error: `Unknown model "${requested}". Use /model to see available models.` };
        }
        return { handled: true, modelChange: requested };
    }

    /**
     * Get autocomplete suggestions for slash commands.
     * @param {string} line - Current input line
     * @returns {[string[], string]} - [completions, original line]
     */
    getCompletions(line) {
        if (!line.startsWith('/')) {
            return [[], line];
        }

        const parsed = this.parseSlashCommand(line);
        if (!parsed) {
            const allCmds = Object.keys(COMMAND_DEFINITIONS).map(cmd => `/${cmd}`);
            return [allCmds, line];
        }

        const { command, subOption, args } = parsed;

        // If just the command name (no sub-option yet), suggest sub-options
        if (subOption === null && !args && line.endsWith(' ')) {
            const subOpts = this.getSubOptions(command);
            if (subOpts) {
                return [subOpts.map(s => `/${command} ${s}`), line];
            }
        }

        // Completing command name
        if (!args && !line.includes(' ')) {
            const cmdPrefix = command.toLowerCase();
            const matchingCmds = Object.keys(COMMAND_DEFINITIONS)
                .filter(cmd => cmd.startsWith(cmdPrefix))
                .map(cmd => `/${cmd}`);
            return [matchingCmds, line];
        }

        // Completing sub-option
        const subOpts = this.getSubOptions(command);
        if (subOpts && !subOption && args) {
            const prefix = args.toLowerCase();
            const matching = subOpts
                .filter(s => s.startsWith(prefix))
                .map(s => `/${command} ${s}`);
            return [matching, line];
        }

        // Command-specific completions
        if (subOption) {
            // /list skills - suggest skill names
            if (command === 'list' && subOption === 'skills') {
                const skills = this.getUserSkills();
                const matching = skills
                    .map(s => s.shortName || s.name)
                    .filter(name => name.toLowerCase().startsWith(args.toLowerCase()))
                    .map(name => `/${command} ${subOption} ${name}`);
                if (matching.length > 0) return [matching, line];
            }
            // /remove skill - suggest skill names
            if (command === 'remove' && subOption === 'skill') {
                const skills = this.getUserSkills();
                const matching = skills
                    .map(s => s.shortName || s.name)
                    .filter(name => name.toLowerCase().startsWith(args.toLowerCase()))
                    .map(name => `/${command} ${subOption} ${name}`);
                return [matching, line];
            }
        }

        // Direct command completions
        const cmdDef = COMMAND_DEFINITIONS[command];
        if (cmdDef) {
            const argPrefix = (args || '').toLowerCase();

            if (['read', 'delete', 'validate', 'generate', 'test', 'refine', 'update', 'specs', 'specs-write', 'write-tests'].includes(command)) {
                const skills = this.getUserSkills();
                const matching = skills
                    .map(s => s.shortName || s.name)
                    .filter(name => name.toLowerCase().startsWith(argPrefix))
                    .map(name => `/${command} ${name}`);
                return [matching, line];
            }

            if (command === 'template') {
                const types = [...getAllSkillTypeNames(), ...DOC_SCAFFOLD_TYPES];
                const matching = types
                    .filter(t => t.startsWith(argPrefix))
                    .map(t => `/${command} ${t}`);
                return [matching, line];
            }

            if (command === 'scaffold') {
                const parts = (args || '').split(/\s+/);
                if (parts.length <= 1) {
                    const matching = DOC_SCAFFOLD_TYPES
                        .filter(t => t.startsWith(parts[0] || ''))
                        .map(t => `/${command} ${t}`);
                    return [matching, line];
                }
                return [[], line];
            }

            if (command === 'exec') {
                const skills = this.getSkills();
                const matching = skills
                    .map(s => s.shortName || s.name)
                    .filter(name => name.toLowerCase().startsWith(argPrefix))
                    .map(name => `/${command} ${name}`);
                return [matching, line];
            }

            if (command === 'write' && args.includes(' ')) {
                const parts = args.split(/\s+/);
                const typePrefix = parts[1]?.toLowerCase() || '';
                const matching = getAllSkillTypeNames()
                    .filter(t => t.startsWith(typePrefix))
                    .map(t => `/${command} ${parts[0]} ${t}`);
                return [matching, line];
            }

            if (command === 'tier') {
                const matching = this.getAvailableTiers()
                    .filter(t => t.startsWith(argPrefix))
                    .map(t => `/${command} ${t}`);
                return [matching, line];
            }

            if (command === 'model') {
                const options = ['clear', ...this.getAvailableModels()];
                const matching = options
                    .filter(m => m.toLowerCase().startsWith(argPrefix))
                    .map(m => `/${command} ${m}`);
                return [matching, line];
            }
        }

        return [[], line];
    }

    /**
     * Get hint text for current input.
     * @param {string} line - Current input line
     * @returns {string|null}
     */
    getInputHint(line) {
        if (!line.startsWith('/')) return null;

        const parsed = this.parseSlashCommand(line);
        if (!parsed) {
            return 'Type a command name (Tab to complete)';
        }

        const { command, subOption, args } = parsed;

        // Show sub-option hint
        if (!subOption && !args && line.endsWith(' ')) {
            const subOpts = this.getSubOptions(command);
            if (subOpts) {
                return `Select: ${subOpts.join(', ')}`;
            }
        }

        const cmdDef = COMMAND_DEFINITIONS[command];
        if (!cmdDef) {
            const partialMatches = Object.keys(COMMAND_DEFINITIONS)
                .filter(cmd => cmd.startsWith(command));
            if (partialMatches.length > 0) {
                return `Did you mean: ${partialMatches.map(c => '/' + c).join(', ')}?`;
            }
            return 'Unknown command. Type /help for available commands.';
        }

        if (subOption) {
            const subDef = this.getSubOptionDef(command, subOption);
            if (subDef && subDef.args === 'required' && !args) {
                return `${subDef.description} — ${subDef.usage}`;
            }
            if (subDef) return subDef.description;
        }

        if (cmdDef.args === 'required' && !args) {
            return `${cmdDef.description} — ${cmdDef.usage}`;
        }

        return cmdDef.description;
    }

    /**
     * Print slash command help.
     */
    printHelp() {
        const helpText = showHelp('commands');
        console.log(helpText);
    }
}

export default SlashCommandHandler;
