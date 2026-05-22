#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { MainAgent, SecuritySupervisor, discoverSkillsFromRoot } from 'achillesAgentLib/MainAgent';
import { LLMAgent } from 'achillesAgentLib/LLMAgents';
import { IOServices } from 'achillesAgentLib';
import { HistoryManager } from './repl/HistoryManager.mjs';
import { CommandSelector, showCommandSelector, showSkillSelector, buildCommandList } from './ui/CommandSelector.mjs';
import { SlashCommandHandler } from './repl/SlashCommandHandler.mjs';
import { REPLSession } from './repl/REPLSession.mjs';
import { summarizeResult, formatSlashResult } from './ui/ResultFormatter.mjs';
import { printHelp as printREPLHelp, showHistory, searchHistory } from './ui/HelpPrinter.mjs';
import { getQuickReference } from './ui/HelpSystem.mjs';
import { UIContext } from './ui/UIContext.mjs';
import { createProvider, getProviderNames } from './ui/providers/index.mjs';
import { BUILT_IN_SKILLS, TIERS } from './lib/constants.mjs';
import { buildOrchestratorSystemPrompt } from './prompts/orchestrator-prompt.mjs';
import { ensureAchillesCliDir, ensureAgentLibLinksForRepos } from './lib/repoManager.mjs';
import { isWebchatEscapeControlChunk, handleWebchatControlChunk } from './lib/webchatControl.mjs';
import { normalizeWebchatMessage } from './lib/webchatEnvelope.mjs';
import { materializeWebchatContext } from './lib/webchatResources.mjs';
import { startIntroSkill } from './lib/introSkillBoot.mjs';
import {
    drainWorkspaceSkillsRefresh,
    installWorkspaceSkillRefreshHook,
    refreshWorkspaceSkillsNow,
} from './lib/workspaceSkillRefresh.mjs';
import { AkuMemoryAdapter } from './lib/akuMemory/AkuMemoryAdapter.mjs';
import { buildAKUPlanningPacket } from './lib/akuMemory/akuPlanningPacket.mjs';
import { formatAKUContextForPrompt, appendAKUContextToPrompt } from './lib/akuMemory/akuContextFormatter.mjs';
import { createAKUSessionState } from './lib/akuMemory/akuSessionState.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to built-in skills bundled with this module
const builtInSkillsDir = path.join(__dirname, 'skills');

// Re-export classes and functions for library usage
export {
    // Core agent (from achillesAgentLib)
    MainAgent,
    LLMAgent,
    // REPL components
    REPLSession,
    SlashCommandHandler,
    // UI components
    CommandSelector,
    showCommandSelector,
    showSkillSelector,
    buildCommandList,
    // History
    HistoryManager,
    // Repository management
    // Utilities
    summarizeResult,
    formatSlashResult,
    isWebchatEscapeControlChunk,
    handleWebchatControlChunk,
    printREPLHelp,
    showHistory,
    searchHistory,
    // Constants
    builtInSkillsDir,
    BUILT_IN_SKILLS,
    lookupCachedProviderResultForPrompt,
    persistProviderLauncherResults,
};

// CLI entry point when run directly
async function main() {
    const args = process.argv.slice(2);

    // Parse options
    let workingDir = process.cwd();
    let prompt = null;
    let verbose = false;
    let debug = false;
    let mode = 'deep';
    let renderMarkdown = true;
    let uiStyle = process.env.ACHILLES_CLI_UI || 'claude-code'; // Default UI style
    let skipBashPermissions = false; // Skip bash command permission prompts
    const cliSkillRoots = []; // Skill roots from --skill-root flags

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--dir' || arg === '-d') {
            workingDir = path.resolve(args[i + 1] || process.cwd());
            i += 1;
        } else if (arg.startsWith('--dir=')) {
            const resolvedDir = arg.slice('--dir='.length);
            if (resolvedDir) {
                workingDir = path.resolve(resolvedDir);
            }
        } else if (arg === '--skill-root' || arg === '-r') {
            const rootPath = args[i + 1];
            if (rootPath && !rootPath.startsWith('-')) {
                cliSkillRoots.push(path.resolve(rootPath));
                i += 1;
            }
        } else if (arg.startsWith('--skill-root=')) {
            const rootPath = arg.split('=')[1];
            if (rootPath) {
                cliSkillRoots.push(path.resolve(rootPath));
            }
        } else if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        } else if (arg === '--verbose' || arg === '-v') {
            verbose = true;
        } else if (arg === '--debug') {
            debug = true;
        } else if (arg === '--fast') {
            mode = 'fast';
        } else if (arg === '--deep') {
            mode = 'deep';
        } else if (arg === '--no-markdown' || arg === '--raw') {
            renderMarkdown = false;
        } else if (arg === '--ui-minimal') {
            uiStyle = 'minimal';
        } else if (arg === '--ui-claude-code') {
            uiStyle = 'claude-code';
        } else if (arg === '--ui' || arg === '--ui-style') {
            uiStyle = args[i + 1] || 'claude-code';
            i += 1;
        } else if (arg.startsWith('--ui=') || arg.startsWith('--ui-style=')) {
            uiStyle = arg.split('=')[1] || 'claude-code';
        } else if (arg === '--version') {
            console.log('achilles-cli v3.0.0');
            process.exit(0);
        } else if (arg === '--skip-permissions') {
            skipBashPermissions = true;
        } else if (!arg.startsWith('-')) {
            // Collect remaining args as the prompt
            prompt = args.slice(i).join(' ');
            break;
        }
    }

    // Configure logger based on verbose flag
    const noop = () => {};
    const achillesDebug = /^(1|true|yes|on)$/i.test(process.env.ACHILLES_DEBUG || '');
    const formatLogArgs = (args) => args.map((entry) => {
        if (entry === null || entry === undefined) {
            return String(entry);
        }
        if (typeof entry === 'object') {
            try {
                return JSON.stringify(entry);
            } catch {
                return String(entry);
            }
        }
        return String(entry);
    }).join(' ');
    const debugLog = achillesDebug ? (...args) => console.log(`[DEBUG] ${formatLogArgs(args)}`) : noop;
    const infoLog = verbose ? (...args) => console.log(`[INFO] ${formatLogArgs(args)}`) : noop;
    const logger = {
        debug: debugLog,
        info: infoLog,
        log: infoLog,
        warn: (msg) => console.warn(`[WARN] ${msg}`),
        error: (msg) => console.error(`[ERROR] ${msg}`),
    };

    // User skills directory (do not create automatically)
    const nodeModulesSkillRoots = collectNodeModulesSkillRoots(__dirname, logger);
    const ploinkyRepoSkillRoots = collectPloinkyRepoSkillRoots(workingDir, process.env, logger);
    const webchatRuntime = !prompt && isWebchatRuntime();
    const skillsDir = path.join(workingDir, 'skills');

    try {
        process.chdir(workingDir);
    } catch (error) {
        console.error(`Error: Unable to change working directory to '${workingDir}': ${error.message}`);
        process.exit(1);
    }

    // Ensure .achilles-cli directory structure exists
    ensureAchillesCliDir(workingDir);
    ensureAgentLibLinksForRepos(workingDir);

    // Merge all skill roots: built-in + CLI flags + node_modules + deployed Ploinky repo skills
    const allSkillRoots = [
        { path: builtInSkillsDir, isInternal: true },
        ...cliSkillRoots.map((skillRoot) => ({ path: skillRoot, isInternal: false })),
        ...nodeModulesSkillRoots.map((skillRoot) => ({ path: skillRoot, isInternal: false, isAgentLibInternal: isAgentLibSkillRoot(skillRoot) })),
        ...ploinkyRepoSkillRoots.map((skillRoot) => ({ path: skillRoot, isInternal: false, isPloinkyRepoSkillRoot: true })),
    ];

    if (verbose && (cliSkillRoots.length > 0 || nodeModulesSkillRoots.length > 0 || ploinkyRepoSkillRoots.length > 0)) {
        logger.log(`Additional skill roots: ${[...cliSkillRoots, ...nodeModulesSkillRoots, ...ploinkyRepoSkillRoots].join(', ')}`);
    }

    const supervisor = webchatRuntime ? new WebchatProgressSupervisor() : null;

    // Initialize MainAgent with all skill roots
    const agent = new MainAgent({
        startDir: workingDir,
        ...(supervisor ? { supervisor } : {}),
        llmAgentOptions: {
            name: 'achilles-cli-agent',
        },
        logger,
    });

    registerSkillRoots(agent, allSkillRoots, logger);
    installWorkspaceSkillRefreshHook(agent);

    // Set up I/O (LLMAgent API fallback to global IOServices)
    const inputReader = createCliInputReader();
    const outputWriter = webchatRuntime
        ? createSilentOutputWriter()
        : createCliOutputWriter();
    if (typeof agent.llmAgent?.setInputReader === 'function') {
        agent.llmAgent.setInputReader(inputReader);
    } else {
        IOServices.setInputReader(inputReader);
    }
    if (typeof agent.llmAgent?.setOutputWriter === 'function') {
        agent.llmAgent.setOutputWriter(outputWriter);
    } else {
        IOServices.setOutputWriter(outputWriter);
    }

    // Initialize UI provider based on selected style
    try {
        const uiProvider = createProvider(uiStyle);
        UIContext.setProvider(uiProvider);
        if (verbose) {
            logger.log(`UI style: ${uiStyle}`);
        }
    } catch (error) {
        console.error(`Error: Invalid UI style '${uiStyle}'. Available: ${getProviderNames().join(', ')}`);
        process.exit(1);
    }

    if (prompt) {
        // Single-shot mode: execute prompt and exit
        try {
            if (verbose) {
                console.log(`Processing: "${prompt}"\n`);
            }
            // Create context for skill execution
            const context = {
                workingDir,
                skillsDir,
                skilledAgent: agent,
                llmAgent: agent.llmAgent,
                logger,
                skipBashPermissions,
            };
            const akuSessionState = createAKUSessionState();
            context.akuSessionState = akuSessionState;
            const akuPrompt = await preparePromptForAKUMemory({
                prompt,
                workingDir,
                workspaceRoot: workingDir,
                context,
                sessionState: akuSessionState,
                logger,
            });
            agent.context = context;
            await startIntroSkill(agent, {
                workingDir,
                context,
                logger,
                write: async (message) => {
                    process.stdout.write(message);
                },
            });

            let result = await agent.executePrompt(akuPrompt.prompt, {
                context,
                mode,
                systemPrompt: buildOrchestratorSystemPrompt(),
            });
            await drainWorkspaceSkillsRefresh(agent, { logger });

            // Format result
            if (typeof result === 'string') {
                try {
                    const parsed = JSON.parse(result);
                    if (parsed && (parsed.executions || parsed.type === 'orchestrator')) {
                        result = debug ? JSON.stringify(parsed, null, 2) : summarizeResult(parsed);
                    }
                } catch {
                    // Not JSON, use as-is
                }
            } else if (!debug) {
                result = summarizeResult(result);
            } else {
                result = JSON.stringify(result, null, 2);
            }

            console.log(result);
        } catch (error) {
            await drainWorkspaceSkillsRefresh(agent, { logger });
            console.error('Error:', error.message);
            if (verbose) {
                console.error(error.stack);
            }
            process.exit(1);
        }
    } else if (webchatRuntime) {
        // Webchat mode: simple stdin → process → stdout loop (no REPL, no banner, no prompt)
        await runWebchatInteractive(agent, {
            workingDir,
            skillsDir,
            skipBashPermissions,
            debug,
            renderMarkdown,
        });
    } else {
        // REPL mode
        const session = new REPLSession(agent, {
            workingDir,
            skillsDir,
            builtInSkillsDir,
            debug,
            renderMarkdown,
            skipBashPermissions,
        });
        await session.start();
    }
}

async function preparePromptForAKUMemory({
    prompt,
    normalizedMessage = null,
    workingDir,
    workspaceRoot,
    context,
    sessionState,
    logger,
}) {
    const adapter = context.akuMemoryAdapter instanceof AkuMemoryAdapter
        ? context.akuMemoryAdapter
        : new AkuMemoryAdapter({
            rootDir: workspaceRoot || workingDir,
            workspaceRoot: workspaceRoot || workingDir,
            actor: 'achilles-cli',
            sessionState,
            logger,
        });
    context.akuMemoryAdapter = adapter;
    context.akuMemoryActions = adapter.createActionSurface();

    const packet = buildAKUPlanningPacket({
        text: prompt,
        rawText: normalizedMessage?.rawText,
        normalizedMessage,
        workingDir,
        workspaceRoot: workspaceRoot || workingDir,
        previousSessionState: sessionState?.toJSON?.() ?? null,
        sessionId: process.env.SSO_SESSION_ID || null,
    });

    try {
        const preflight = await adapter.preparePromptMemory(packet);
        context.akuMemoryPreflight = preflight;
        const memoryContext = formatAKUContextForPrompt(preflight);
        return {
            prompt: appendAKUContextToPrompt(prompt, memoryContext),
            preflight,
            memoryContext,
        };
    } catch (error) {
        logger?.debug?.(`AKU memory preflight skipped: ${error.message}`);
        context.akuMemoryPreflight = {
            enabled: false,
            initialized: false,
            diagnostics: [`AKU memory preflight skipped: ${error.message}`],
        };
        return {
            prompt,
            preflight: context.akuMemoryPreflight,
            memoryContext: '',
        };
    }
}

async function lookupCachedProviderResultForPrompt(context, {
    prompt,
    workingDir,
    logger,
} = {}) {
    const adapter = context?.akuMemoryAdapter;
    if (!(adapter instanceof AkuMemoryAdapter)) {
        return { hit: false, reason: 'aku_adapter_unavailable' };
    }
    const cached = await adapter.lookupCachedAgentResult({
        prompt,
        workingDir,
    });
    if (!cached?.hit || !String(cached.resultText || '').trim()) {
        return cached || { hit: false, reason: 'miss' };
    }
    logger?.debug?.(`AKU provider-result cache hit: ${cached.backend || 'unknown'} (${cached.provenance || 'aku'})`);
    return {
        ...cached,
        resultText: String(cached.resultText || '').trim(),
    };
}

async function persistProviderLauncherResults(context, {
    prompt,
    workingDir,
    fromIndex = 0,
    logger,
} = {}) {
    const adapter = context?.akuMemoryAdapter;
    const launcherResults = Array.isArray(context?.providerLauncherResults)
        ? context.providerLauncherResults.slice(Math.max(0, Number(fromIndex) || 0))
        : [];
    if (!(adapter instanceof AkuMemoryAdapter) || !launcherResults.length) {
        return [];
    }
    const persisted = [];
    for (const entry of launcherResults) {
        const result = entry?.result && typeof entry.result === 'object' ? entry.result : entry;
        const backend = String(entry?.backend || result?.backend || '').trim();
        const resultText = String(result?.result_text || result?.final_answer || result?.natural_language_output || '').trim();
        if (!backend || !resultText) {
            continue;
        }
        try {
            persisted.push(await adapter.persistAgentResult({
                prompt: entry?.prompt || prompt,
                backend,
                resultText,
                workingDir,
                cacheable: result?.cacheable === true,
                ttlHintSeconds: result?.persistence_hint?.ttl_hint_seconds ?? entry?.ttlHintSeconds,
                originPaths: collectWebchatOriginPaths(context),
                metadata: {
                    launcher: String(entry?.launcher || '').trim() || undefined,
                    ok: typeof result?.ok === 'boolean' ? result.ok : undefined,
                    provider_availability: result?.diagnostics?.providerAvailability,
                },
            }));
        } catch (error) {
            logger?.debug?.(`AKU provider-result postflight skipped: ${error.message}`);
            persisted.push({ ok: false, error: error.message });
        }
    }
    return persisted;
}

function collectWebchatOriginPaths(context = {}) {
    const paths = [];
    for (const entry of Array.isArray(context.webchatPaths) ? context.webchatPaths : []) {
        if (typeof entry === 'string') {
            paths.push(entry);
        } else if (entry && typeof entry === 'object') {
            paths.push(entry.path);
        }
    }
    for (const resource of Array.isArray(context.webchatResources) ? context.webchatResources : []) {
        if (resource && typeof resource === 'object') {
            paths.push(resource.path || resource.name);
        }
    }
    return [...new Set(paths.map((value) => String(value || '').trim()).filter(Boolean))];
}

function isWebchatRuntime() {
    if (hasSsoEnvironment()) {
        return true;
    }
    return process.argv.some((arg) => typeof arg === 'string' && (
        arg.startsWith('--sso-user=')
        || arg.startsWith('--sso-user-id=')
        || arg.startsWith('--sso-email=')
        || arg.startsWith('--sso-roles=')
        || arg.startsWith('--sso-session-id=')
    ));
}

function hasSsoEnvironment() {
    return [
        'SSO_USER',
        'SSO_USER_ID',
        'SSO_EMAIL',
        'SSO_ROLES',
        'SSO_SESSION_ID',
    ].some((key) => {
        const value = process.env[key];
        return typeof value === 'string' && value.trim().length > 0;
    });
}

async function runWebchatInteractive(agent, options) {
    const { workingDir, skillsDir, skipBashPermissions, debug, renderMarkdown } = options;
    const historyManager = new HistoryManager({ workingDir });
    const akuSessionState = createAKUSessionState();
    const slashState = {
        activeTier: TIERS.FAST,
        pinnedModel: null,
        markdownEnabled: renderMarkdown !== false,
    };
    const context = {
        workingDir,
        skillsDir,
        skilledAgent: agent,
        llmAgent: agent.llmAgent,
        skipBashPermissions,
    };
    context.akuSessionState = akuSessionState;
    agent.context = context;
    await startIntroSkill(agent, {
        workingDir,
        context,
        logger: agent.logger,
        onStart: async () => {
            emitWebchatProgress('intro-skill', 'Generating workspace intro');
        },
        write: async (message) => {
            process.stdout.write(message);
        },
    });
    const slashHandler = new SlashCommandHandler({
        executeSkill: (skillName, input, opts) => executeWebchatSkill({
            agent,
            skillName,
            input,
            opts,
            slashState,
        }),
        getUserSkills: () => agent.getSkills().filter((skill) => !skill.isInternal),
        getSkills: () => agent.getSkills(),
        buildSkills: async () => {
            await refreshWorkspaceSkillsNow(agent, { logger: agent.logger });
        },
        historyManager,
    });

    let isClosing = false;
    let isProcessing = false;
    let activeAbortController = null;
    let pendingLines = [];
    let partialLine = '';
    let flushTimer = null;
    let processingChain = Promise.resolve();
    const stdinIsTTY = Boolean(process.stdin?.isTTY);
    const handleControlData = (chunk) => {
        handleWebchatControlChunk(chunk, {
            agent,
            isProcessing,
            abortController: activeAbortController
        });
    };

    const flushPendingLines = () => {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        if (pendingLines.length === 0) {
            return;
        }

        const normalizedMessage = normalizeWebchatMessage(pendingLines.join('\n'));
        updateWebchatContextForMessage(context, normalizedMessage, { workingDir });
        pendingLines = [];

        const message = normalizedMessage.text.trim();
        if (!message) {
            return;
        }
        if (message === 'exit' || message === 'quit' || message === ':q') {
            process.stdout.write('Use /exit only in terminal REPL mode.\n');
            return;
        }

        processingChain = processingChain.then(async () => {
            isProcessing = true;
            activeAbortController = new AbortController();
            const isSlash = slashHandler.isSlashCommand(message);
            try {
                if (isSlash) {
                    const slashOutput = await executeWebchatSlashCommand({
                        input: message,
                        slashHandler,
                        historyManager,
                        slashState,
                        context,
                        signal: activeAbortController.signal,
                    });
                    if (slashOutput?.exit) {
                        process.stdout.write(`${slashOutput.output || 'Exit is not supported in webchat.'}\n`);
                    } else if (slashOutput?.output) {
                        process.stdout.write(`${slashOutput.output}\n`);
                    }
                } else {
                    const akuPrompt = await preparePromptForAKUMemory({
                        prompt: message,
                        normalizedMessage,
                        workingDir,
                        workspaceRoot: workingDir,
                        context,
                        sessionState: akuSessionState,
                        logger: agent.logger,
                    });

                    const cachedProviderResult = await lookupCachedProviderResultForPrompt(context, {
                        prompt: message,
                        workingDir,
                        logger: agent.logger,
                    });
                    if (cachedProviderResult?.hit) {
                        process.stdout.write(`${cachedProviderResult.resultText}\n`);
                        historyManager.add(message);
                        return;
                    }

                    if (!Array.isArray(context.providerLauncherResults)) {
                        context.providerLauncherResults = [];
                    }
                    const launcherResultStart = context.providerLauncherResults.length;
                    let result = await agent.executePrompt(akuPrompt.prompt, {
                        signal: activeAbortController.signal,
                        context,
                        supervisor: agent.supervisor || null,
                        model: slashState.pinnedModel || undefined,
                        tier: slashState.activeTier,
                        systemPrompt: buildOrchestratorSystemPrompt(),
                    });
                    await drainWorkspaceSkillsRefresh(agent, { logger: agent.logger });
                    result = formatExecutionResult(result, debug);
                    await persistProviderLauncherResults(context, {
                        prompt: message,
                        workingDir,
                        fromIndex: launcherResultStart,
                        logger: agent.logger,
                    });

                    process.stdout.write(`${result}\n`);
                    historyManager.add(message);
                }
            } catch (error) {
                if (activeAbortController?.signal?.aborted || error?.name === 'AbortError') {
                    process.stdout.write('[cancelled]\n');
                } else {
                    process.stdout.write(`[error] ${error.message}\n`);
                }
            } finally {
                await drainWorkspaceSkillsRefresh(agent, { logger: agent.logger });
                isProcessing = false;
                activeAbortController = null;
            }
        });
    };

    const scheduleFlush = () => {
        if (flushTimer) {
            clearTimeout(flushTimer);
        }
        flushTimer = setTimeout(() => {
            flushPendingLines();
        }, 150);
    };

    try {
        if (stdinIsTTY && typeof process.stdin.setRawMode === 'function') {
            process.stdin.setRawMode(true);
        }
        process.stdin.resume();

        await new Promise((resolve) => {
            const handleData = (chunk) => {
                handleControlData(chunk);

                const text = Buffer.isBuffer(chunk)
                    ? chunk.toString('utf8')
                    : String(chunk ?? '');

                if (!text) {
                    return;
                }

                const normalized = text.replace(/\r\n/g, '\n');
                const segments = normalized.split('\n');
                segments[0] = partialLine + segments[0];

                if (normalized.endsWith('\n')) {
                    partialLine = '';
                } else {
                    partialLine = segments.pop() ?? '';
                    if (partialLine.includes('\x1b') || partialLine.includes('\u001b')) {
                        partialLine = '';
                    }
                }

                for (const segment of segments) {
                    if (segment.includes('\x1b') || segment.includes('\u001b')) {
                        continue;
                    }
                    pendingLines.push(segment);
                    scheduleFlush();
                }
            };

            const handleEnd = () => {
                if (partialLine.length > 0) {
                    pendingLines.push(partialLine);
                    partialLine = '';
                }
                isClosing = true;
                flushPendingLines();
                resolve();
            };

            process.stdin.on('data', handleData);
            process.stdin.once('end', handleEnd);
            process.stdin.once('close', handleEnd);

            handleControlData.cleanup = () => {
                process.stdin.removeListener('data', handleData);
                process.stdin.removeListener('end', handleEnd);
                process.stdin.removeListener('close', handleEnd);
            };
        });
        await processingChain;
    } finally {
        try {
            handleControlData.cleanup?.();
        } catch (_) {}
        if (stdinIsTTY && typeof process.stdin.setRawMode === 'function') {
            try {
                process.stdin.setRawMode(false);
            } catch (_) {}
        }
    }
}

async function executeWebchatSkill({ agent, skillName, input, opts = {}, slashState }) {
    const execOpts = {
        tier: slashState.activeTier,
        ...opts,
    };
    if (!execOpts.supervisor) {
        execOpts.supervisor = agent?.supervisor || null;
    }
    if (slashState.pinnedModel) {
        execOpts.model = slashState.pinnedModel;
    }

    try {
        try {
            return await agent.executeSkill(skillName, input, execOpts);
        } catch (error) {
            if (!isSkillNotFoundError(error)) {
                throw error;
            }
            return await executeBuiltInSkillModule(skillName, agent, input);
        }
    } finally {
        await drainWorkspaceSkillsRefresh(agent, { logger: agent.logger });
    }
}

function isSkillNotFoundError(error) {
    return Boolean(error && typeof error.message === 'string' && error.message.includes('not found'));
}

async function executeBuiltInSkillModule(skillName, agent, input) {
    if (!skillName) {
        throw new Error('Skill name is required.');
    }

    const modulePath = path.join(builtInSkillsDir, skillName, 'src', 'index.mjs');
    try {
        const loaded = await import(pathToFileURL(modulePath).href);
        if (typeof loaded?.action !== 'function') {
            throw new Error(`Built-in module "${skillName}" has no action() export.`);
        }
        return loaded.action({ mainAgent: agent, promptText: input });
    } catch {
        throw new Error(`Skill "${skillName}" not found.`);
    }
}

async function executeWebchatSlashCommand({
    input,
    slashHandler,
    historyManager,
    slashState,
    context,
    signal,
}) {
    const parsed = slashHandler.parseSlashCommand(input);
    if (!parsed) {
        return { output: `Unknown command: ${input}` };
    }

    const fullArgs = parsed.subOption
        ? `${parsed.subOption} ${parsed.args}`.trim()
        : parsed.args;
    const result = await slashHandler.executeSlashCommand(parsed.command, fullArgs, {
        context,
        signal,
    });

    if (!result?.handled) {
        return { output: result?.error || `Unknown command: ${input}` };
    }

    historyManager.add(input);

    if (result.exitRepl) {
        return { exit: true, output: 'Exit is not supported in webchat. Close the tab to end the session.' };
    }
    if (result.reloadSkills) {
        await refreshWorkspaceSkillsNow(context.skilledAgent, { logger: context.skilledAgent?.logger });
        return { output: `Indexed ${context.skilledAgent.getSkills().length} skill(s).` };
    }
    if (result.showHistory) {
        return { output: formatHistoryEntries(historyManager.getRecent(10)) };
    }
    if (result.showHistoryCount) {
        return { output: formatHistoryEntries(historyManager.getRecent(result.showHistoryCount)) };
    }
    if (result.searchHistory) {
        return { output: formatHistoryEntries(historyManager.search(result.searchHistory)) };
    }
    if (result.tierChange) {
        slashState.activeTier = result.tierChange;
        slashState.pinnedModel = null;
        return { output: `Tier set to ${slashState.activeTier}.` };
    }
    if (result.modelChange !== undefined) {
        slashState.pinnedModel = result.modelChange;
        return { output: slashState.pinnedModel ? `Model pinned: ${slashState.pinnedModel}` : 'Model pin cleared.' };
    }
    if (result.toggleMarkdown) {
        slashState.markdownEnabled = !slashState.markdownEnabled;
        return { output: `Markdown rendering ${slashState.markdownEnabled ? 'enabled' : 'disabled'}.` };
    }
    if (result.showHelpPicker) {
        return { output: getQuickReference() };
    }
    if (result.showTierPicker) {
        const tiers = slashHandler.getAvailableTiers();
        return { output: `Current tier: ${slashState.activeTier}\nAvailable tiers: ${tiers.join(', ')}` };
    }
    if (result.showModelPicker) {
        const models = slashHandler.getAvailableModels();
        const current = slashState.pinnedModel || '(none)';
        return { output: `Pinned model: ${current}\nAvailable models:\n${models.map((model) => `- ${model}`).join('\n')}` };
    }
    if (result.showTestPicker) {
        return { output: 'Usage: /test <skill-name>' };
    }
    if (result.showRunTestsPicker) {
        return { output: 'Usage: /run-tests <skill-name|all>' };
    }
    if (result.result) {
        return { output: result.result };
    }
    if (result.error) {
        return { output: result.error };
    }

    return { output: '' };
}

function formatHistoryEntries(entries = []) {
    if (!Array.isArray(entries) || entries.length === 0) {
        return 'No history entries.';
    }
    return entries.map((entry) => `${entry.index}. ${entry.command}`).join('\n');
}

function updateWebchatContextForMessage(context, normalizedMessage, { workingDir }) {
    const materialized = materializeWebchatContext(normalizedMessage, { workingDir });
    context.invocationToken = String(normalizedMessage?.invocationToken || '').trim();
    context.webchatAttachments = Array.isArray(normalizedMessage?.attachments) ? normalizedMessage.attachments : [];
    context.webchatReferences = Array.isArray(normalizedMessage?.references) ? normalizedMessage.references : [];
    context.webchatResources = materialized.resources;
    context.webchatPaths = materialized.paths;
    context.webchatResourceWarnings = materialized.warnings;
    context.webchatOrigin = {
        ...((normalizedMessage?.origin && typeof normalizedMessage.origin === 'object') ? normalizedMessage.origin : {}),
        type: 'semantic-copilot',
        surface: 'webchat',
        agent: 'achilles-cli',
        working_directory: workingDir || '',
    };
}

function formatExecutionResult(result, debug = false) {
    if (result && typeof result === 'object' && Object.hasOwn(result, 'result')) {
        result = result.result;
    }
    if (typeof result === 'string') {
        try {
            const parsed = JSON.parse(result);
            if (parsed && (parsed.executions || parsed.type === 'orchestrator')) {
                return debug ? JSON.stringify(parsed, null, 2) : summarizeResult(parsed);
            }
        } catch {
            // Not JSON, use as-is.
        }
        return result;
    }
    if (!debug) {
        return summarizeResult(result);
    }
    return JSON.stringify(result, null, 2);
}

function emitWebchatProgress(tool, reason) {
    const text = String(reason || '').trim();
    if (!text) {
        return;
    }
    const payload = {
        __webchatProgress: 1,
        type: 'tool_reason',
        tool: typeof tool === 'string' ? tool : '',
        reason: text,
        stepIndex: null,
    };
    process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function createCliInputReader() {
    return {
        read: async (prompt = '> ') => {
            if (!process.stdin.isTTY) {
                throw new Error('Interactive input requested but stdin is not a TTY.');
            }

            return new Promise((resolve) => {
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout,
                });

                let done = false;
                const finalize = (answer = '') => {
                    if (done) return;
                    done = true;
                    rl.close();
                    resolve(answer);
                };

                rl.on('SIGINT', () => finalize(''));
                rl.question(prompt, (answer) => finalize(answer));
            });
        },
    };
}

function createCliOutputWriter() {
    return {
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
}

function createSilentOutputWriter() {
    return {
        write: async () => {},
        writeError: async () => {},
    };
}

class WebchatProgressSupervisor extends SecuritySupervisor {
    async approve() {
        return 'alwaysApprove';
    }

    getOutputWriter() {
        return {
            write: async (message) => {
                if (!message || typeof message !== 'object' || message.type !== 'tool_reason') {
                    return;
                }
                const reason = String(message.reason || '').trim();
                if (!reason) {
                    return;
                }
                const payload = {
                    __webchatProgress: 1,
                    type: 'tool_reason',
                    tool: typeof message.tool === 'string' ? message.tool : '',
                    reason,
                    stepIndex: Number.isFinite(message.stepIndex) ? message.stepIndex : null,
                };
                process.stdout.write(`${JSON.stringify(payload)}\n`);
            },
        };
    }
}

function printHelp() {
    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                         Achilles CLI v3.0                            ║
║        Manage, generate, and test skill definition files              ║
╚══════════════════════════════════════════════════════════════════════╝

USAGE:
  achilles-cli [options] [prompt]

OPTIONS:
  -d, --dir <path>       Working directory containing skills (default: cwd)
  -r, --skill-root <path>  Add additional skill root (can be used multiple times)
  -v, --verbose          Enable verbose logging
  --debug                Show full JSON output (orchestrator plans, executions)
  --fast                 Use fast LLM mode (cheaper, quicker)
  --deep                 Use deep LLM mode (default, more capable)
  --no-markdown          Disable markdown rendering in output (use /raw to toggle)
  --skip-permissions     Skip bash command permission prompts (use with caution)
  --ui <style>           UI style: claude-code (default), minimal
  --ui-minimal           Use minimal UI (no colors, simple prompts)
  --ui-claude-code       Use Claude Code style UI (boxed input, animations)
  -h, --help             Show this help message
  --version              Show version

MODES:
  REPL Mode          Run without a prompt to enter interactive mode
  Single-shot Mode   Pass a prompt as arguments to execute and exit

HISTORY:
  Command history is stored per working directory in .achilles-cli-history
  Use ↑/↓ arrows to navigate history, "history" command to view/search

BUILT-IN SKILLS:
  list-skills        List all registered skills
  read-skill         Read a skill definition file
  write-skill        Create or update a skill file
  delete-skill       Remove a skill directory
  validate-skill     Validate skill against schema
  get-template       Get blank template for skill type
  update-section     Update a specific section
  preview-changes    Show diff before applying
  generate-code      Generate .mjs from tskill
  test-code          Test generated code
  skill-refiner      Iterative improvement loop

SKILL TYPES:
  tskill   Database table (fields, validators, presenters)
  cskill   Code skill (LLM-generated code execution)
  dcgskill Dynamic code generation (text/code or module)
  oskill   Orchestrator (routes to other skills)
  mskill   MCP tool integration

EXTERNAL SKILLS:
  Skills can be installed via npm and discovered in node_modules.

  You can also add session-only skill roots:
    achilles-cli -r /path/to/skills -r /another/path

EXAMPLES:
  # Start interactive REPL
  achilles-cli
  achilles-cli --dir /path/to/project

  # Single-shot commands
  achilles-cli "list all skills"
  achilles-cli "read the equipment skill"
  achilles-cli "create a tskill called inventory for tracking stock"
  achilles-cli "validate the area skill"
  achilles-cli "generate code for equipment"
  achilles-cli "test the generated code for equipment"
  achilles-cli "refine equipment until all tests pass"
  achilles-cli --fast "list skills"

  # With additional skill roots
  achilles-cli -r ~/shared-skills "list all skills"

ENVIRONMENT:
  ANTHROPIC_API_KEY    API key for Claude (required)
  OPENAI_API_KEY       Alternative: API key for OpenAI
  ACHILLES_CLI_UI     Default UI style (claude-code, minimal)

For more information, see the README.md in the AchillesCliAgent directory.
`);
}

/**
 * Check if this module is being run directly (cross-platform safe)
 */
function isRunDirectly() {
    if (!process.argv[1]) {
        return false;
    }
    try {
        const scriptPath = realpathSync(process.argv[1]);
        const modulePath = realpathSync(fileURLToPath(import.meta.url));
        return scriptPath === modulePath;
    } catch {
        // Fallback for edge cases
        return import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
    }
}

function collectNodeModulesSkillRoots(baseDir, logger) {
    const nodeModulesDir = path.join(baseDir, '..', 'node_modules');
    if (!fs.existsSync(nodeModulesDir)) {
        return [];
    }

    let entries = [];
    try {
        entries = fs.readdirSync(nodeModulesDir, { withFileTypes: true });
    } catch (error) {
        logger?.warn?.(`Failed to read node_modules: ${error.message}`);
        return [];
    }

    const roots = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        if (entry.name.startsWith('@')) {
            continue;
        }

        const packageDir = path.join(nodeModulesDir, entry.name);
        const skillRoots = [
            path.join(packageDir, 'skills'),
            path.join(packageDir, 'src', 'skills'),
        ];
        for (const skillRoot of skillRoots) {
            if (fs.existsSync(skillRoot)) {
                roots.push(skillRoot);
            }
        }
    }

    return roots;
}

export function collectPloinkyRepoSkillRoots(workingDir = process.cwd(), env = process.env, logger = null) {
    const roots = [];
    const workspaceRoots = collectWorkspaceRootCandidates(workingDir, env);
    for (const workspaceRoot of workspaceRoots) {
        const reposDir = path.join(workspaceRoot, '.ploinky', 'repos');
        if (!isDirectory(reposDir)) {
            continue;
        }

        let entries = [];
        try {
            entries = fs.readdirSync(reposDir, { withFileTypes: true });
        } catch (error) {
            logger?.warn?.(`Failed to read Ploinky repo skill roots: ${error.message}`);
            continue;
        }

        for (const entry of entries) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) {
                continue;
            }
            const skillRoot = path.join(reposDir, entry.name, 'achilles-skills');
            if (isDirectory(skillRoot)) {
                roots.push(skillRoot);
            }
        }
    }
    return uniquePaths(roots);
}

function collectWorkspaceRootCandidates(workingDir, env) {
    const roots = [];
    const addWithAncestors = (value) => {
        const text = String(value || '').trim();
        if (!text) {
            return;
        }
        let current = path.resolve(text);
        for (let depth = 0; depth < 12; depth += 1) {
            roots.push(current);
            const parent = path.dirname(current);
            if (!parent || parent === current) {
                break;
            }
            current = parent;
        }
    };

    addWithAncestors(env?.PLOINKY_WORKSPACE_ROOT);
    addWithAncestors(env?.PLOINKY_CWD);
    addWithAncestors(workingDir);
    addWithAncestors(env?.WORKSPACE_PATH);

    return uniquePaths(roots);
}

function uniquePaths(paths) {
    const seen = new Set();
    const unique = [];
    for (const candidate of paths) {
        const normalized = path.normalize(String(candidate || ''));
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        unique.push(normalized);
    }
    return unique;
}

function isDirectory(candidate) {
    try {
        return fs.statSync(candidate).isDirectory();
    } catch {
        return false;
    }
}

function isAgentLibSkillRoot(skillRoot) {
    const normalized = path.normalize(String(skillRoot || ''));
    const segments = normalized.split(path.sep).filter(Boolean);
    for (let index = 0; index < segments.length - 1; index += 1) {
        if (segments[index] === 'achillesAgentLib' && segments[index + 1] === 'skills') {
            return true;
        }
    }
    return false;
}

function registerSkillRoots(agent, skillRoots, logger) {
    if (!agent || !Array.isArray(skillRoots) || skillRoots.length === 0) {
        return;
    }

    const seen = new Set();
    const rootSummaries = [];
    for (const root of skillRoots) {
        const skillRoot = root?.path;
        if (!skillRoot || seen.has(skillRoot)) {
            continue;
        }
        seen.add(skillRoot);

        if (!fs.existsSync(skillRoot)) {
            continue;
        }
        if (root.isAgentLibInternal && agent.disableInternalSkills) {
            logger?.debug?.(`MainAgent:skipAgentLibInternalSkillRoot: ${skillRoot}: agentLib internal skills disabled`);
            continue;
        }

        let discovered = [];
        try {
            discovered = discoverSkillsFromRoot(skillRoot, { logger });
        } catch (error) {
            logger?.warn?.(`Failed to discover skills from ${skillRoot}: ${error.message}`);
            continue;
        }

        rootSummaries.push({
            skillRoot,
            isInternal: Boolean(root.isInternal),
            discoveredCount: discovered.length,
            skills: discovered.map((skill) => ({
                name: skill.name,
                shortName: skill.shortName,
                type: skill.type,
                skillDir: skill.skillDir,
            })),
        });

        for (const skillRecord of discovered) {
            skillRecord.isInternal = Boolean(root.isInternal);
            agent._registerSkill(skillRecord);
        }
    }

    agent._refreshOrchestratedSkillIndex?.();
    agent.debugSkillRegistrationSummary?.({
        phase: 'after achilles-cli additional skill roots',
        additionalRoots: rootSummaries,
    });
}

function sanitiseSkillName(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

// Run if executed directly
if (isRunDirectly()) {
    main().catch((error) => {
        console.error('Fatal error:', error.message);
        process.exit(1);
    });
}
