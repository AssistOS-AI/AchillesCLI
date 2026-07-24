/**
 * NaturalLanguageProcessor - Handles LLM processing with abort capability.
 *
 * Extracted from REPLSession to improve modularity and reduce file size.
 */

import readline from 'node:readline';
import { createSpinner } from '../ui/spinner.mjs';
import { renderMarkdown } from '../ui/MarkdownRenderer.mjs';
import { colors, icons, style, line, box } from '../ui/theme.mjs';
import { IOServices } from 'achillesAgentLib';

/**
 * NaturalLanguageProcessor class for handling LLM interactions.
 */
export class NaturalLanguageProcessor {
    /**
     * Create a new NaturalLanguageProcessor.
     *
     * @param {Object} options - Processor options
     * @param {Object} options.agent - The MainAgent instance
     * @param {Function} options.processPrompt - Callback to process prompts
     * @param {HistoryManager} options.historyManager - Command history manager
     * @param {Function} options.isMarkdownEnabled - Callback to check markdown state
     */
    constructor(options) {
        this.agent = options.agent;
        this.processPrompt = options.processPrompt;
        this.historyManager = options.historyManager;
        this.isMarkdownEnabled = options.isMarkdownEnabled || (() => true);
        this.approvalController = options.approvalController || null;
    }

    /**
     * Process a natural language prompt through the LLM.
     * @param {string} input - The user input
     */
    async process(input) {
        // Create AbortController for ESC cancellation
        const abortController = new AbortController();
        let wasInterrupted = false;

        // Create ActionReporter for real-time feedback (Claude Code style)
        const actionReporter = new (await import('achillesAgentLib/utils/ActionReporter.mjs')).ActionReporter({
            mode: 'spinner',
            spinnerFactory: createSpinner,
            showInterruptHint: true,
        });

        // Set up ESC key listener
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

        // Enable raw mode to capture individual keypresses
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.on('data', handleKeypress);
        }

        // Set up a prompt reader that pauses the reporter during user input
        const llmAgent = this.agent.llmAgent;
        const hasSetter = typeof llmAgent?.setInputReader === 'function';
        const previousInputReader = hasSetter
            ? (llmAgent?.inputReader || null)
            : IOServices.getInputReader();

        if (llmAgent) {
            const interactiveReader = {
                read: async (prompt = '> ') => {
                    if (!process.stdin.isTTY) {
                        throw new Error('Interactive input requested but stdin is not a TTY.');
                    }

                    actionReporter.pause();
                    suspendInput();

                    return new Promise((resolve) => {
                        const rl = readline.createInterface({
                            input: process.stdin,
                            output: process.stdout,
                        });
                        rl.question(prompt, (answer) => {
                            rl.close();
                            restoreInput();
                            actionReporter.resume();
                            resolve(answer);
                        });
                    });
                },
            };

            if (hasSetter) {
                llmAgent.setInputReader(interactiveReader);
            } else {
                IOServices.setInputReader(interactiveReader);
            }
        }

        // Start with initial "Thinking" action
        actionReporter.thinking();
        const approvalMonitor = this.approvalController?.start({
            pause: () => actionReporter.pause(),
            resume: () => actionReporter.resume(),
            suspendInput,
            restoreInput,
        });

        try {
            const result = await this.processPrompt(input, {
                signal: abortController.signal,
            });

            // Complete any remaining actions
            actionReporter.reset();

            console.log(style(line(60, box.horizontal), colors.dim));
            console.log(this.isMarkdownEnabled() ? renderMarkdown(result) : result);
            console.log(style(line(60, box.horizontal), colors.dim) + '\n');
        } catch (error) {
            if (wasInterrupted || error.name === 'AbortError') {
                actionReporter.interrupted('Operation cancelled');
                console.log('');
            } else {
                actionReporter.failAction(error);
                console.error(`\n${error.message}\n`);
            }
        } finally {
            await approvalMonitor?.stop();
            // Clean up ESC listener
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(false);
                process.stdin.removeListener('data', handleKeypress);
            }

            // Restore previous input reader
            if (llmAgent) {
                if (hasSetter) {
                    llmAgent.setInputReader(previousInputReader);
                } else {
                    IOServices.setInputReader(previousInputReader);
                }
            }

            // Save command to history (unless interrupted)
            if (!wasInterrupted) {
                this.historyManager.add(input);
            }
        }
    }
}

export default NaturalLanguageProcessor;
