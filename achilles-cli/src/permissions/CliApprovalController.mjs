import { APPROVAL_DECISIONS } from './protocol.mjs';
import { showCommandSelector } from '../ui/CommandSelector.mjs';
import { UIContext } from '../ui/UIContext.mjs';

export const CLI_APPROVAL_OPTIONS = Object.freeze([
    {
        name: 'Always allow',
        value: APPROVAL_DECISIONS.ALWAYS_ALLOW,
        description: 'Allow this exact Bash request again during this chat',
    },
    {
        name: 'Allow',
        value: APPROVAL_DECISIONS.ALLOW,
        description: 'Allow this Bash request once',
    },
    {
        name: 'Deny',
        value: APPROVAL_DECISIONS.DENY,
        description: 'Do not run this Bash request',
    },
]);

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatApprovalMessage(prompt) {
    return String(prompt || 'Bash approval required')
        .replace(/\nReply with: allow, deny, or always allow\.$/, '')
        .trim();
}

export class CliApprovalController {
    constructor({
        approvalControlClient,
        selector = showCommandSelector,
        output = process.stdout,
        pollIntervalMs = 50,
    } = {}) {
        this.approvalControlClient = approvalControlClient;
        this.selector = selector;
        this.output = output;
        this.pollIntervalMs = Math.max(5, Number(pollIntervalMs) || 50);
    }

    start({ pause, resume, suspendInput, restoreInput } = {}) {
        if (!this.approvalControlClient) {
            return { stop: async () => {} };
        }

        let stopped = false;
        const handled = new Set();
        const run = (async () => {
            while (!stopped) {
                let pending = null;
                try {
                    pending = await this.approvalControlClient.getPendingApproval();
                } catch {
                    // A transient Broker read must not terminate the active CLI operation.
                }

                if (pending?.pending && pending.interactionId && !handled.has(pending.interactionId)) {
                    handled.add(pending.interactionId);
                    pause?.();
                    suspendInput?.();
                    let decision = APPROVAL_DECISIONS.DENY;
                    try {
                        this.output.write(`\n${formatApprovalMessage(pending.prompt)}\n`);
                        const selected = await this.selector(CLI_APPROVAL_OPTIONS, {
                            prompt: 'Permission> ',
                            initialFilter: '',
                            maxVisible: CLI_APPROVAL_OPTIONS.length,
                            theme: UIContext.getTheme(),
                        });
                        decision = selected?.value || APPROVAL_DECISIONS.DENY;
                    } catch (error) {
                        this.output.write(`\nApproval selector failed: ${error.message}\n`);
                    }

                    try {
                        await this.approvalControlClient.resolvePendingApproval(
                            decision,
                            pending.interactionId,
                        );
                    } catch (error) {
                        handled.delete(pending.interactionId);
                        this.output.write(`\nCould not submit approval: ${error.message}\n`);
                    } finally {
                        restoreInput?.();
                        resume?.();
                    }
                    continue;
                }

                await delay(this.pollIntervalMs);
            }
        })();

        return {
            stop: async () => {
                stopped = true;
                await run;
            },
        };
    }
}

export default CliApprovalController;
