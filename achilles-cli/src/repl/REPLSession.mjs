/**
 * REPLSession - Manages the interactive REPL session for MainAgent.
 *
 * Coordinates between InteractivePrompt and NaturalLanguageProcessor
 * to provide a complete interactive CLI experience.
 * All input starting with / is a command; everything else goes to the LLM.
 */

import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import { LineEditor } from '../ui/LineEditor.mjs';
import { createSpinner } from '../ui/spinner.mjs';
import { buildCommandList, showCommandSelector, showTestSelector, showHelpSelector, showTierSelector, showModelSelector } from '../ui/CommandSelector.mjs';
import { SlashCommandHandler } from './SlashCommandHandler.mjs';
import { summarizeResult } from '../ui/ResultFormatter.mjs';
import { HistoryManager } from './HistoryManager.mjs';
import { renderMarkdown } from '../ui/MarkdownRenderer.mjs';
import { InteractivePrompt } from './InteractivePrompt.mjs';
import { NaturalLanguageProcessor } from './NaturalLanguageProcessor.mjs';
import { discoverSkillTests, runTestFile, runTestSuite } from '../lib/testDiscovery.mjs';
import { TIERS } from '../lib/constants.mjs';
import { formatTestResult, formatSuiteResults } from '../ui/TestResultFormatter.mjs';
import { showHelp, getHelpTopics, getCommandHelp } from '../ui/HelpSystem.mjs';
import { UIContext } from '../ui/UIContext.mjs';
import { buildOrchestratorSystemPrompt } from '../prompts/orchestrator-prompt.mjs';
import { IOServices } from 'achillesAgentLib';
import { ensureAchillesCliDir, ensureAgentLibLinksForRepos } from '../lib/repoManager.mjs';
import { showHistory, searchHistory } from '../ui/HelpPrinter.mjs';
import { startIntroSkill } from '../lib/introSkillBoot.mjs';
import {
    drainWorkspaceSkillsRefresh,
    installWorkspaceSkillRefreshHook,
    refreshWorkspaceSkillsNow,
} from '../lib/workspaceSkillRefresh.mjs';
import {
    buildTaskCompletions,
    formatWorkspaceTaskDetail,
    formatWorkspaceTaskSummary,
} from '../lib/workspaceTasks.mjs';
import { createWebchatBackgroundTaskManager } from '../lib/webchatBackgroundTasks.mjs';
import {
    formatSoulGatewayModelDescription,
    loadSoulGatewayModels,
} from '../lib/soulGatewayModels.mjs';
import {
    clearSelectedModel,
    getSelectedModel,
    setSelectedModel,
} from '../lib/achillesSettings.mjs';
import {
    buildConversationInitialHistory,
    ConversationSessionStore,
} from '../lib/conversationSessionStore.mjs';
import { CliApprovalController } from '../permissions/CliApprovalController.mjs';
import {
    createWorkspaceSkillsSnapshot,
    formatWorkspaceSkills,
    setWorkspaceDirectoryEnabled,
    setWorkspaceSkillEnabled,
} from '../lib/workspaceSkillsState.mjs';

// Import tier utilities from achillesAgentLib (direct path — not re-exported from index)
let _listTiersFromCache = null;
try {
    const llmClient = await import('achillesAgentLib/utils/LLMClient.mjs');
    _listTiersFromCache = llmClient.listTiersFromCache;
} catch {
    // achillesAgentLib not available — tier commands will show an error
}

/**
 * REPLSession class for managing interactive CLI sessions.
 */
export class REPLSession {
    /**
     * Create a new REPLSession.
     *
     * @param {MainAgent} agent - The MainAgent instance
     * @param {Object} options - Session options
     * @param {string} options.workingDir - Working directory path
     * @param {string} [options.skillsDir] - Skills directory path (defaults to workingDir/skills)
     * @param {string} [options.builtInSkillsDir] - Built-in skills directory (for filtering user skills)
     * @param {HistoryManager} [options.historyManager] - Command history manager (created if not provided)
     * @param {boolean} [options.debug] - Enable debug mode
     * @param {string} [options.tier] - Initial LLM tier (default: 'fast')
     */
    constructor(agent, options = {}) {
        this.agent = agent;
        this.options = options;

        // Configuration
        this.workingDir = options.workingDir || agent.startDir;
        this.skillsDir = options.skillsDir || path.join(this.workingDir, 'skills');
        this.builtInSkillsDir = options.builtInSkillsDir || null;
        this.debug = options.debug || false;

        // Ensure .achilles-cli directory structure exists
        ensureAchillesCliDir(this.workingDir);
        ensureAgentLibLinksForRepos(this.workingDir);
        installWorkspaceSkillRefreshHook(agent);

        // Active LLM tier for all prompt executions
        this.activeTier = options.tier || TIERS.FAST;

        // Workspace-selected model (bypasses tier cascade when set)
        this.pinnedModel = getSelectedModel(this.workingDir);

        // History manager
        this.historyManager = options.historyManager || new HistoryManager({
            workingDir: this.workingDir,
        });
        this.sessionStore = options.sessionStore || new ConversationSessionStore({
            workingDir: this.workingDir,
        });
        this.currentConversation = this.sessionStore.ensureCurrentSession();
        this.pendingConversationHistory = buildConversationInitialHistory(this.currentConversation);
        this.activeTurn = null;
        this.taskManager = null;

        // Context for skill execution
        this.context = {
            workingDir: this.workingDir,
            skillsDir: this.skillsDir,
            skilledAgent: agent,
            llmAgent: agent.llmAgent,
            logger: agent.logger,
            bashExecutor: options.bashExecutor,
        };

        // Attach context directly to agent for skills that access agent.context
        agent.context = this.context;

        // Create slash command handler with callbacks
        this.slashHandler = new SlashCommandHandler({
            executeSkill: (skillName, input, opts) => this._executeSkill(skillName, input, opts),
            getUserSkills: () => this.getUserSkills(),
            getSkills: () => this.agent.getSkills(),
            buildSkills: () => this.reloadSkills(),
            historyManager: this.historyManager,
            getTaskSummary: (args) => formatWorkspaceTaskSummary(this.workingDir, args),
            getPermissions: options.getPermissions,
            setPermissions: options.setPermissions,
            getSessions: () => this.sessionStore.listSessions(),
            createSession: () => this._activateConversation(this.sessionStore.createSession()),
            resumeSession: (sessionId) => this._activateConversation(this.sessionStore.resumeSession(sessionId)),
            viewTask: (taskId) => {
                this.taskManager?.viewTask(taskId);
                return formatWorkspaceTaskDetail(this.workingDir, taskId);
            },
            continueTask: (taskId, prompt) => this.taskManager?.continueTask(taskId, prompt),
            stopTask: (taskId) => this.taskManager?.stopTask(taskId),
            getTaskCompletions: (action) => buildTaskCompletions(this.workingDir, action),
            getSkillState: () => createWorkspaceSkillsSnapshot(this.agent, this.workingDir),
            setSkillEnabled: (name, enabled) => setWorkspaceSkillEnabled(
                this.agent,
                this.workingDir,
                name,
                enabled,
            ),
            setSkillsDirectoryEnabled: (directory, enabled) => setWorkspaceDirectoryEnabled(
                this.agent,
                this.workingDir,
                directory,
                enabled,
            ),
        });

        // Build command list for interactive selector
        this.commandList = buildCommandList(SlashCommandHandler.COMMANDS);

        // Markdown rendering toggle (default: enabled)
        this.markdownEnabled = options.renderMarkdown !== false;
        this.approvalController = options.approvalControlClient
            ? new CliApprovalController({
                approvalControlClient: options.approvalControlClient,
            })
            : null;

        // Initialize sub-modules
        this.inputPrompt = new InteractivePrompt({
            historyManager: this.historyManager,
            slashHandler: this.slashHandler,
            commandList: this.commandList,
            getUserSkills: () => this.getUserSkills(),
            getAllSkills: () => this.agent.getSkills(),
            getModelName: () => this.pinnedModel || this._getCurrentTierModel(),
        });

        this.nlProcessor = new NaturalLanguageProcessor({
            agent: this.agent,
            processPrompt: (input, opts) => this.processPrompt(input, opts),
            historyManager: this.historyManager,
            isMarkdownEnabled: () => this.markdownEnabled,
            approvalController: this.approvalController,
        });

        this._activeSpinner = null;
        this._activeSpinnerMessage = '';
        this._registerLLMIO();
    }

    _setActiveSpinner(spinner) {
        this._activeSpinner = spinner;
        this._activeSpinnerMessage = spinner?.message || '';
    }

    _registerLLMIO() {
        const llmAgent = this.agent?.llmAgent;
        if (!llmAgent) {
            return;
        }

        const { colors } = UIContext.getTheme();

        const inputReader = {
            read: async (prompt = '> ') => {
                if (!process.stdin.isTTY) {
                    throw new Error('Interactive input requested but stdin is not a TTY.');
                }

                const spinner = this._activeSpinner;
                const previousMessage = this._activeSpinnerMessage;
                if (spinner) {
                    spinner.update?.('Awaiting Input...');
                    spinner.pause?.();
                }

                const answer = await this._promptWithBox(prompt, colors);

                if (spinner) {
                    spinner.update?.(previousMessage || spinner.message || 'Running...');
                    spinner.resume?.();
                }

                return answer;
            },
        };

        const outputWriter = {
            write: async (message) => {
                if (message === null || message === undefined) {
                    return;
                }
                const text = typeof message === 'string'
                    ? message
                    : JSON.stringify(message, null, 2);
                console.log(text);
            },
        };

        if (typeof llmAgent.setInputReader === 'function') {
            llmAgent.setInputReader(inputReader);
        } else {
            IOServices.setInputReader(inputReader);
        }

        if (typeof llmAgent.setOutputWriter === 'function') {
            llmAgent.setOutputWriter(outputWriter);
        } else {
            IOServices.setOutputWriter(outputWriter);
        }
    }

    /**
     * Execute a skill directly via MainAgent.executeSkill()
     * @private
     */
    async _executeSkill(skillName, input, opts = {}) {
        this._logEnvSnapshot(`execute-skill:${skillName}`);
        const execOpts = {
            tier: this.activeTier,
            ...opts,
        };
        if (this.pinnedModel) {
            execOpts.model = this.pinnedModel;
        }
        try {
            try {
                return await this.agent.executeSkill(skillName, input, execOpts);
            } catch (error) {
                if (!this._isSkillNotFoundError(error)) {
                    throw error;
                }
                return await this._executeBuiltInSkillModule(skillName, input);
            }
        } finally {
            await drainWorkspaceSkillsRefresh(this.agent, { logger: this.agent.logger });
        }
    }

    _isSkillNotFoundError(error) {
        return Boolean(error && typeof error.message === 'string' && error.message.includes('not found'));
    }

    async _executeBuiltInSkillModule(skillName, input) {
        if (!this.builtInSkillsDir || !skillName) {
            throw new Error(`Skill "${skillName}" not found.`);
        }

        const modulePath = path.join(this.builtInSkillsDir, skillName, 'src', 'index.mjs');
        try {
            const loaded = await import(pathToFileURL(modulePath).href);
            if (typeof loaded?.action !== 'function') {
                throw new Error(`Built-in module "${skillName}" has no action() export.`);
            }
            return loaded.action({ mainAgent: this.agent, promptText: input });
        } catch {
            throw new Error(`Skill "${skillName}" not found.`);
        }
    }

    /**
     * Get user skills (exclude internal/built-in skills)
     */
    getUserSkills() {
        return this.agent.getSkills().filter(s => !s.isInternal);
    }

    /**
     * Reload skills from disk
     */
    async reloadSkills() {
        try {
            await refreshWorkspaceSkillsNow(this.agent, { logger: this.agent.logger });
            return this.agent.getSkills().length;
        } catch (e) {
            return this.agent.getSkills().length;
        }
    }

    /**
     * Process a natural language prompt via MainAgent.executePrompt()
     */
    async processPrompt(userPrompt, opts = {}) {
        const { ...restOptions } = opts;

        this._logEnvSnapshot('process-prompt');
        const execOpts = {
            model: this.pinnedModel || this.activeTier,
            systemPrompt: buildOrchestratorSystemPrompt(),
            ...restOptions,
        };
        if (this.pendingConversationHistory.length > 0) {
            execOpts.initialHistory = this.pendingConversationHistory;
        }
        // History belongs to this process bootstrap and is offered to exactly one
        // natural-language execution, even when that execution is cancelled.
        this.pendingConversationHistory = [];
        const turn = this.sessionStore.beginTurn({ text: userPrompt });
        this.activeTurn = turn;
        this.currentConversation = turn.session;
        let result;
        try {
            result = await this.agent.executePrompt(userPrompt, execOpts);
        } catch (error) {
            this.currentConversation = this.sessionStore.completeTurn(
                turn.session.sessionId,
                turn.assistantMessageIndex,
                error?.name === 'AbortError' ? '[cancelled]' : (error?.message || String(error)),
            );
            throw error;
        } finally {
            this.activeTurn = null;
            await drainWorkspaceSkillsRefresh(this.agent, { logger: this.agent.logger });
        }

        // If result is a JSON string, parse it to get the object
        if (typeof result === 'string') {
            try {
                const parsed = JSON.parse(result);
                if (parsed && (parsed.executions || parsed.type === 'orchestrator')) {
                    result = parsed;
                } else {
                    this.currentConversation = this.sessionStore.completeTurn(
                        turn.session.sessionId,
                        turn.assistantMessageIndex,
                        result,
                    );
                    return result;
                }
            } catch {
                this.currentConversation = this.sessionStore.completeTurn(
                    turn.session.sessionId,
                    turn.assistantMessageIndex,
                    result,
                );
                return result;
            }
        }

        // In debug mode, show full JSON
        if (this.debug) {
            if (result?.result) {
                const formatted = typeof result.result === 'string'
                    ? result.result
                    : JSON.stringify(result.result, null, 2);
                this.currentConversation = this.sessionStore.completeTurn(
                    turn.session.sessionId,
                    turn.assistantMessageIndex,
                    formatted,
                );
                return formatted;
            }
            if (result?.output) {
                this.currentConversation = this.sessionStore.completeTurn(
                    turn.session.sessionId,
                    turn.assistantMessageIndex,
                    result.output,
                );
                return result.output;
            }
            const formatted = JSON.stringify(result, null, 2);
            this.currentConversation = this.sessionStore.completeTurn(
                turn.session.sessionId,
                turn.assistantMessageIndex,
                formatted,
            );
            return formatted;
        }

        // Non-debug mode: show summarized output
        const formatted = summarizeResult(result);
        this.currentConversation = this.sessionStore.completeTurn(
            turn.session.sessionId,
            turn.assistantMessageIndex,
            formatted,
        );
        return formatted;
    }

    async _activateConversation(session) {
        if (typeof this.options.createAgent !== 'function') {
            throw new Error('This runtime cannot replace its MainAgent for a conversation switch.');
        }
        this.agent.cancelCurrentSession?.('session-changed');
        const nextAgent = await this.options.createAgent();
        this.agent = nextAgent;
        this.context.skilledAgent = nextAgent;
        this.context.llmAgent = nextAgent.llmAgent;
        nextAgent.context = this.context;
        this.nlProcessor.agent = nextAgent;
        this.currentConversation = session;
        this.pendingConversationHistory = buildConversationInitialHistory(session);
        this.activeTier = TIERS.FAST;
        this.pinnedModel = getSelectedModel(this.workingDir);
        this._registerLLMIO();
        return session;
    }

    _formatSessionList(payload) {
        const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
        if (sessions.length === 0) return 'No saved conversation sessions.';
        return sessions.map((session) => {
            const marker = session.sessionId === payload.currentSessionId ? '*' : ' ';
            return `${marker} ${session.sessionId}  ${session.preview || 'New session'}  ${session.updatedAt}`;
        }).join('\n');
    }

    _printConversation(session) {
        for (const message of session?.messages || []) {
            if (message?.type === 'task') {
                console.log(`[task] ${message.taskId}`);
                continue;
            }
            const text = String(message?.text || '').trim();
            if (!text) continue;
            console.log(`${message.role === 'user' ? 'you' : 'assistant'}> ${text}`);
        }
    }

    async _handleSessionPicker() {
        const payload = this.sessionStore.listSessions();
        const items = [
            { name: 'New', description: 'Create a new conversation session' },
            ...payload.sessions.map((session) => ({
                name: session.sessionId,
                description: `${session.preview || 'New session'} · ${session.updatedAt}`,
            })),
        ];
        const selected = await showCommandSelector(items, {
            prompt: 'Session> ',
            maxVisible: 10,
            theme: UIContext.getTheme(),
        });
        if (!selected) return null;
        const session = selected.name === 'New'
            ? this.sessionStore.createSession()
            : this.sessionStore.resumeSession(selected.name);
        await this._activateConversation(session);
        return session;
    }

    /**
     * Get the current model name (pinned or tier default).
     * @private
     */
    _getCurrentTierModel() {
        if (this.pinnedModel) return this.pinnedModel;
        try {
            const tierModels = _listTiersFromCache?.();
            const tierModelList = tierModels?.[this.activeTier];
            return tierModelList?.[0] || null;
        } catch {
            return null;
        }
    }

    /**
     * Show the startup banner.
     * @private
     */
    _showBanner() {
        const userSkills = this.getUserSkills();
        const theme = UIContext.getTheme();
        const { colors, icons } = theme;

        // Helper to apply style
        const style = (text, ...styles) => {
            const styleStr = styles.map(s => colors[s] || s).join('');
            return `${styleStr}${text}${colors.reset}`;
        };

        // Helper to create header bar
        const headerBar = (title, width = 50) => {
            const padding = Math.floor((width - title.length - 2) / 2);
            const leftPad = '─'.repeat(padding);
            const rightPad = '─'.repeat(width - title.length - 2 - padding);
            return `${colors.cyan}${leftPad} ${colors.bold}${title}${colors.reset}${colors.cyan} ${rightPad}${colors.reset}`;
        };

        // Minimal header
        console.log('');
        console.log(headerBar('Achilles CLI', 50));
        console.log('');

        // Session info as key-value pairs
        const shortWorkDir = this.workingDir.replace(process.env.HOME, '~');
        console.log(`  ${style('cwd', 'cyan')}  ${shortWorkDir}`);

        // Show LLM tier and model info
        try {
            if (this.pinnedModel) {
                console.log(`  ${style('llm', 'cyan')}  ${this.pinnedModel} ${style('[selected]', 'yellow')}`);
            } else {
                const tierModels = _listTiersFromCache?.();
                const tierModelList = tierModels?.[this.activeTier];
                const primaryModel = tierModelList?.[0] || 'unknown';
                const tierColor = [TIERS.DEEP, TIERS.ULTRA].includes(this.activeTier) ? 'magenta' : 'green';
                console.log(`  ${style('llm', 'cyan')}  ${primaryModel} ${style(`[${this.activeTier}]`, tierColor)}`);
            }
        } catch (e) {
            // Fallback to legacy mode display
            try {
                const description = this.agent.llmAgent.invokerStrategy?.describe?.();
                if (description) {
                    const models = this.activeTier === TIERS.DEEP ? description.deepModels : description.fastModels;
                    const primaryModel = models?.[0]?.name || 'unknown';
                    console.log(`  ${style('llm', 'cyan')}  ${primaryModel} ${style(`[${this.activeTier}]`, 'green')}`);
                }
            } catch {
                // Ignore
            }
        }

        // Skills summary
        if (userSkills.length > 0) {
            console.log('');
            console.log(`  ${style(icons.bullet, 'green')} ${userSkills.length} skill(s) loaded`);

            // Group skills by type
            const byType = {};
            for (const s of userSkills) {
                const type = s.type || 'unknown';
                if (!byType[type]) byType[type] = [];
                byType[type].push(s.shortName || s.name);
            }

            // Show grouped skills (max 4 per type, then ellipsis)
            for (const [type, names] of Object.entries(byType)) {
                const displayNames = names.slice(0, 4);
                const more = names.length > 4 ? ` ${style(`+${names.length - 4} more`, 'dim')}` : '';
                console.log(`    ${style(type, 'dim')} ${displayNames.join(', ')}${more}`);
            }
        } else {
            console.log('');
            console.log(`  ${style(icons.hollowBullet, 'yellow')} No skills found`);
        }

        // History hint
        if (this.historyManager.length > 0) {
            console.log('');
            console.log(`  ${style(icons.bullet, 'dim')} ${this.historyManager.length} history entries ${style('(↑/↓ to navigate)', 'dim')}`);
        }

        // Commands hint
        console.log('');
        console.log(`  ${style('Type "/" for commands, or describe what you need', 'dim')}`);
        console.log('');
    }

    _logEnvSnapshot(reason) {
        const debug = this.agent?.logger?.debug;
        if (typeof debug !== 'function') {
            return;
        }

        const prefixes = [
            'ACHILLES_',
            'LLM_',
            'OPENAI_',
            'OPENROUTER_',
            'ANTHROPIC_',
            'GEMINI_',
            'XAI_',
            'MISTRAL_',
            'HUGGINGFACE_',
            'OPENCODE_',
            'AXIOLOGIC_',
        ];

        const isSensitive = (key) => /KEY|TOKEN|SECRET|PASSWORD/i.test(key);
        const entries = Object.entries(process.env)
            .filter(([key]) => prefixes.some((prefix) => key.startsWith(prefix)))
            .sort(([a], [b]) => a.localeCompare(b));

        debug(`[AchillesCli] Env snapshot (${reason})`);
        if (!entries.length) {
            debug('[AchillesCli]   (no matching env vars found)');
            return;
        }

        for (const [key, value] of entries) {
            const displayValue = isSensitive(key)
                ? (value ? '[set]' : '')
                : (value ?? '');
            debug(`[AchillesCli]   ${key}=${displayValue}`);
        }
    }

    /**
     * Start the interactive REPL session.
     * @returns {Promise<void>}
     */
    async start() {
        this.taskManager = await createWebchatBackgroundTaskManager({
            workingDir: this.workingDir,
            emitProtocol: false,
            onTaskStarted: (task) => {
                if (!this.activeTurn || !task?.id) return null;
                return this.sessionStore.insertTask(
                    this.activeTurn.session.sessionId,
                    this.activeTurn.assistantMessageIndex,
                    task.id,
                );
            },
        });
        this.context.backgroundTaskManager = this.taskManager;
        this._showBanner();
        if (this.currentConversation.messages.length === 0) {
            await startIntroSkill(this.agent, {
                workingDir: this.workingDir,
                context: this.context,
                logger: this.agent.logger,
                model: this.pinnedModel || this.activeTier,
                write: async (message) => {
                    console.log(String(message || '').trimEnd());
                },
            });
        }

        // Main REPL loop
        try {
            while (true) {
                const input = (await this.inputPrompt.prompt()).trim();

                if (!input) continue;

                // Slash commands (direct execution)
                if (this.slashHandler.isSlashCommand(input)) {
                    const shouldExit = await this._handleSlashCommand(input);
                    if (shouldExit) break;
                    continue;
                }

                // Natural language prompt - process via LLM
                await this.nlProcessor.process(input);
            }
        } finally {
            this.taskManager?.close();
        }
    }

    /**
     * Handle a slash command.
     * @param {string} input - The slash command input
     * @returns {Promise<boolean>} True if REPL should exit
     * @private
     */
    async _handleSlashCommand(input) {
        const parsed = this.slashHandler.parseSlashCommand(input);
        if (!parsed) return false;

        const commandLabel = parsed.subOption ? `${parsed.command} ${parsed.subOption}` : parsed.command;
        const spinner = createSpinner(`Running /${commandLabel}...`);
        this._setActiveSpinner(spinner);

        const abortController = new AbortController();
        let wasInterrupted = false;
        const handleKeypress = (key) => {
            const keyStr = key?.toString?.() || '';
            if (keyStr === '\x1b' || keyStr === '\u001b') {
                wasInterrupted = true;
                abortController.abort('esc');
                if (typeof this.agent?.cancelCurrentSession === 'function') {
                    this.agent.cancelCurrentSession('esc');
                }
            }
        };

        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.on('data', handleKeypress);
        }

        const suspendInput = () => {
            if (!process.stdin.isTTY) return;
            process.stdin.setRawMode(false);
            process.stdin.removeListener('data', handleKeypress);
        };
        const restoreInput = () => {
            if (!process.stdin.isTTY || wasInterrupted) return;
            process.stdin.setRawMode(true);
            process.stdin.removeListener('data', handleKeypress);
            process.stdin.on('data', handleKeypress);
        };
        const approvalMonitor = this.approvalController?.start({
            pause: () => spinner.pause?.(),
            resume: () => spinner.resume?.(),
            suspendInput,
            restoreInput,
        });

        try {
            const fullArgs = parsed.subOption
                ? `${parsed.subOption} ${parsed.args}`.trim()
                : parsed.args;
            const result = await this.slashHandler.executeSlashCommand(parsed.command, fullArgs, {
                context: this.context,
                signal: abortController.signal,
            });

            if (wasInterrupted || abortController.signal.aborted) {
                spinner.stop();
                console.log('\nOperation cancelled.\n');
                return false;
            }

            if (result.handled) {
                if (result.exitRepl) {
                    spinner.stop();
                    console.log('\nGoodbye!\n');
                    return true;
                }
                if (result.reloadSkills) {
                    const count = await this.reloadSkills();
                    spinner.succeed(`Indexed ${count} skill(s). Use /build to generate pending code.`);
                } else if (result.showHistory) {
                    spinner.stop();
                    showHistory(this.historyManager);
                } else if (result.showHistoryCount) {
                    spinner.stop();
                    showHistory(this.historyManager, result.showHistoryCount);
                } else if (result.searchHistory) {
                    spinner.stop();
                    searchHistory(this.historyManager, result.searchHistory);
                } else if (result.tierChange) {
                    this.activeTier = result.tierChange;
                    this.pinnedModel = null;
                    clearSelectedModel(this.workingDir);
                    const tierModels = _listTiersFromCache?.() || {};
                    const models = tierModels[this.activeTier] || [];
                    const primaryModel = models[0] || 'unknown';
                    spinner.succeed(`Tier: ${this.activeTier} → ${primaryModel}${models.length > 1 ? ` (+${models.length - 1} fallback${models.length > 2 ? 's' : ''})` : ''}`);
                } else if (result.showTierPicker) {
                    spinner.stop();
                    await this._handleTierPicker();
                } else if (result.showModelPicker) {
                    spinner.stop();
                    await this._handleModelPicker();
                } else if (result.hasOwnProperty('modelChange')) {
                    this.pinnedModel = result.modelChange;
                    setSelectedModel(this.workingDir, this.pinnedModel);
                    spinner.succeed(`Model selected: ${this.pinnedModel}`);
                } else if (result.toggleMarkdown) {
                    this.markdownEnabled = !this.markdownEnabled;
                    spinner.succeed(`Markdown rendering ${this.markdownEnabled ? 'enabled' : 'disabled'}`);
                } else if (result.showTestPicker) {
                    spinner.stop();
                    await this._handleTestPicker();
                } else if (result.showRunTestsPicker) {
                    spinner.stop();
                    await this._handleRunTestsPicker();
                } else if (result.showHelpPicker) {
                    spinner.stop();
                    await this._handleHelpPicker();
                } else if (result.skillState) {
                    spinner.stop();
                    if (result.error) console.error(result.error);
                    console.log(`${formatWorkspaceSkills(result.skillState)}\n`);
                } else if (result.showSessionPicker) {
                    spinner.stop();
                    const selected = await this._handleSessionPicker();
                    if (selected) {
                        console.log(`\nSession ${selected.sessionId}\n`);
                        this._printConversation(selected);
                        console.log('');
                    }
                } else if (result.sessionList) {
                    spinner.stop();
                    console.log(`${this._formatSessionList(result.sessionList)}\n`);
                } else if (result.sessionChanged) {
                    spinner.stop();
                    console.log(`\nSession ${result.sessionChanged.sessionId}\n`);
                    this._printConversation(result.sessionChanged);
                    console.log('');
                } else if (result.error) {
                    spinner.fail(result.error);
                } else if (result.result) {
                    spinner.succeed(`/${commandLabel} complete`);
                    console.log('-'.repeat(60));
                    console.log(this.markdownEnabled ? renderMarkdown(result.result) : result.result);
                    console.log('-'.repeat(60) + '\n');
                } else {
                    spinner.stop();
                }
                if (!result.error && !wasInterrupted) {
                    this.historyManager.add(input);
                }
            } else {
                spinner.fail(result.error || `Unknown command: /${parsed.command}`);
            }
        } catch (error) {
            if (wasInterrupted || error?.name === 'AbortError') {
                spinner.stop();
                console.log('\nOperation cancelled.\n');
            } else {
                spinner.fail(error.message);
            }
        } finally {
            await approvalMonitor?.stop();
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(false);
                process.stdin.removeListener('data', handleKeypress);
            }
        }

        this._setActiveSpinner(null);

        return false;
    }

    /**
     * Handle interactive test picker when /test is called without args.
     * @private
     */
    async _handleTestPicker() {
        // Discover available tests
        const tests = discoverSkillTests(this.agent);

        if (tests.length === 0) {
            console.log('\nNo tests found. Create .tests.mjs files in skill directories to add tests.\n');
            return;
        }

        console.log(`\nFound ${tests.length} test(s). Select one to run:\n`);

        // Show interactive test selector
        const selected = await showTestSelector(tests, {
            prompt: 'Select test> ',
            maxVisible: 10,
            theme: UIContext.getTheme(),
        });

        if (!selected) {
            console.log('\nTest selection cancelled.\n');
            return;
        }

        // Run the selected test
        const spinner = createSpinner(`Running tests for ${selected.skillName}...`);

        try {
            const testResult = await runTestFile(selected.testFile, {
                timeout: 30000,
                verbose: false,
            });

            // Add skill info to result
            const fullResult = {
                ...selected,
                ...testResult,
            };

            spinner.succeed(`Tests for ${selected.skillName} complete`);
            console.log('-'.repeat(60));
            console.log(formatTestResult(fullResult));
            console.log('-'.repeat(60) + '\n');

            // Save to history
            this.historyManager.add(`/test ${selected.skillName}`);
        } catch (error) {
            spinner.fail(`Test error: ${error.message}`);
        }
    }

    /**
     * Handle interactive test picker when /run-tests is called without args.
     * Shows an option to run all tests plus individual test options.
     * @private
     */
    async _handleRunTestsPicker() {
        // Discover available tests
        const tests = discoverSkillTests(this.agent);

        if (tests.length === 0) {
            console.log('\nNo tests found. Create .tests.mjs files in skill directories to add tests.\n');
            return;
        }

        // Add "Run All Tests" as first option
        const options = [
            { skillName: 'all', shortName: 'all', skillType: 'all', testFile: null, description: `Run all ${tests.length} test(s)` },
            ...tests,
        ];

        console.log(`\nFound ${tests.length} test(s). Select one to run:\n`);

        // Show interactive test selector
        let selected;
        try {
            selected = await showTestSelector(options, {
                prompt: 'Select test> ',
                maxVisible: 10,
                theme: UIContext.getTheme(),
            });
        } catch (error) {
            console.error(`\nError showing test selector: ${error.message}\n`);
            return;
        }

        if (!selected) {
            console.log('\nTest selection cancelled.\n');
            return;
        }

        // Run all tests or selected test
        if (selected.skillName === 'all') {
            const spinner = createSpinner(`Running all ${tests.length} test(s)...`);

            try {
                const suiteResult = await runTestSuite(tests, {
                    timeout: 30000,
                    verbose: false,
                });

                spinner.succeed('Test suite complete');
                console.log('-'.repeat(60));
                console.log(formatSuiteResults(suiteResult));
                console.log('-'.repeat(60) + '\n');

                // Save to history
                this.historyManager.add('/run-tests all');
            } catch (error) {
                spinner.fail(`Test suite error: ${error.message}`);
            }
        } else {
            const spinner = createSpinner(`Running tests for ${selected.skillName}...`);

            try {
                const testResult = await runTestFile(selected.testFile, {
                    timeout: 30000,
                    verbose: false,
                });

                // Add skill info to result
                const fullResult = {
                    ...selected,
                    ...testResult,
                };

                spinner.succeed(`Tests for ${selected.skillName} complete`);
                console.log('-'.repeat(60));
                console.log(formatTestResult(fullResult));
                console.log('-'.repeat(60) + '\n');

                // Save to history
                this.historyManager.add(`/run-tests ${selected.skillName}`);
            } catch (error) {
                spinner.fail(`Test error: ${error.message}`);
            }
        }
    }

    /**
     * Handle interactive help picker when /help is called without args.
     * Shows available help topics and commands for user to select.
     * @private
     */
    async _handleHelpPicker() {
        // Build help topics list
        const topics = getHelpTopics();
        const commands = getCommandHelp();

        // Combine topics and commands into a single list
        const helpItems = [
            // Topics first (grouped)
            ...topics.map(t => ({
                name: t.name,
                title: t.title,
                description: t.title,
                type: 'topic',
            })),
            // Then individual commands
            ...commands.map(c => ({
                name: `/${c.name}`,
                title: c.title,
                description: c.title,
                type: 'command',
            })),
        ];

        console.log(`\nSelect a help topic or command:\n`);

        // Show interactive help selector
        let selected;
        try {
            selected = await showHelpSelector(helpItems, {
                prompt: 'Help> ',
                maxVisible: 12,
                theme: UIContext.getTheme(),
            });
        } catch (error) {
            console.error(`\nError showing help selector: ${error.message}\n`);
            return;
        }

        if (!selected) {
            console.log('\nHelp selection cancelled.\n');
            return;
        }

        // Display the selected help topic
        const topicName = selected.type === 'command'
            ? selected.name.slice(1) // Remove leading /
            : selected.name;

        const helpText = showHelp(topicName);
        console.log(helpText);

        // Save to history
        this.historyManager.add(`/help ${topicName}`);
    }

    /**
     * Handle interactive tier picker when /tier is called without args.
     * @private
     */
    async _handleTierPicker() {
        const tiers = _listTiersFromCache?.();
        if (!tiers || Object.keys(tiers).length === 0) {
            console.log('\nNo tiers available.\n');
            return;
        }

        const selected = await showTierSelector(tiers, this.activeTier, {
            theme: UIContext.getTheme(),
        });

        if (!selected) {
            return;
        }

        this.activeTier = selected.name;
        this.pinnedModel = null; // Clear model pin on tier switch
        clearSelectedModel(this.workingDir);

        const models = tiers[this.activeTier] || [];
        const primaryModel = models[0] || 'unknown';
        console.log(`Tier: ${this.activeTier} → ${primaryModel}${models.length > 1 ? ` (+${models.length - 1} fallback${models.length > 2 ? 's' : ''})` : ''}`);

        this.historyManager.add(`/tier ${this.activeTier}`);
    }

    /**
     * Handle interactive model picker when /model is called without args.
     * @private
     */
    async _handleModelPicker() {
        let models;
        try {
            models = await loadSoulGatewayModels({ selectedModel: this.pinnedModel });
        } catch (error) {
            console.log(`\n${error.message}\n`);
            return;
        }

        const selected = await showModelSelector(models.map((model) => ({
            name: model.name,
            description: formatSoulGatewayModelDescription(model),
        })), {
            theme: UIContext.getTheme(),
        });

        if (!selected) {
            return;
        }

        this.pinnedModel = selected.name;
        setSelectedModel(this.workingDir, this.pinnedModel);
        console.log(`Model selected: ${this.pinnedModel}`);

        this.historyManager.add(`/model ${this.pinnedModel}`);
    }

    async _promptWithBox(prompt, colors) {
        const question = typeof prompt === 'string' && prompt.trim()
            ? prompt.trim()
            : 'Please provide the missing details.';

        if (!process.stdin.isTTY) {
            return new Promise((resolve) => {
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout,
                });
                let answered = false;
                const finalize = (answer = '') => {
                    if (answered) return;
                    answered = true;
                    rl.close();
                    resolve(answer);
                };
                rl.on('SIGINT', () => finalize(''));
                rl.question(`${question}\n> `, (answer) => finalize(answer));
            });
        }

        process.stdout.write(`\n${colors.dim}${question}${colors.reset}\n`);

        return new Promise((resolve) => {
            const editor = new LineEditor({
                prompt: `${colors.cyan}${colors.bold}>${colors.reset} `,
                rightHint: `${colors.dim}↵ send${colors.reset}`,
                boxed: true,
            });

            editor.render();
            process.stdin.setRawMode(true);
            process.stdin.resume();
            LineEditor.enableBracketedPaste();

            const cleanup = () => {
                if (editor.boxed) {
                    editor.drawBottomBorder();
                }
                LineEditor.disableBracketedPaste();
                process.stdin.setRawMode(false);
                process.stdin.removeListener('data', handleKey);
            };

            const handleKey = (key) => {
                const keyStr = key.toString();

                if (keyStr === '\x03') {
                    cleanup();
                    process.stdout.write('\n');
                    resolve('');
                    return;
                }

                if (keyStr === '\r' || keyStr === '\n') {
                    const value = editor.getBuffer();
                    cleanup();
                    process.stdout.write('\n');
                    resolve(value);
                    return;
                }

                const action = editor.processKey(keyStr);
                if (action === 'modified' || action === 'cursor') {
                    editor.render();
                }
            };

            process.stdin.on('data', handleKey);
        });
    }
}

export default REPLSession;
