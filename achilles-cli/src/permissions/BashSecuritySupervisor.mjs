import { SecuritySupervisor } from 'achillesAgentLib/MainAgent';
import { PERMISSION_MODES } from './protocol.mjs';
import { parseCommandLine } from '../skills/bash/src/parser.mjs';
import { expandGlobsInArgs } from '../skills/bash/src/globExpander.mjs';

export class BashSecuritySupervisor extends SecuritySupervisor {
    #brokerClient;

    constructor({ brokerClient, logger = console, outputWriter = null } = {}) {
        super({ logger });
        this.#brokerClient = brokerClient;
        this.mode = PERMISSION_MODES.ASK;
        this.outputWriter = outputWriter;
    }

    async approve(toolChoice = {}) {
        if (toolChoice.toolName !== 'bash') {
            return 'approve';
        }
        const params = normalizeBashParams(toolChoice.params ?? toolChoice.prompt);
        const response = await this.#brokerClient.authorize('bash', params);
        if (response.status === 'approved') {
            return {
                decision: response.always ? 'alwaysApprove' : 'approve',
            };
        }
        return {
            decision: 'deny',
            status: response.status,
            reason: response.reason || 'The user denied this Bash command. It was not executed.',
        };
    }

    getOutputWriter() {
        return this.outputWriter || super.getOutputWriter();
    }
}

export function normalizeBashParams(value) {
    if (value && typeof value === 'object' && typeof value.command === 'string') {
        return {
            command: value.command,
            args: Array.isArray(value.args) ? value.args.map(String) : [],
            raw: typeof value.raw === 'string' ? value.raw : value.command,
        };
    }
    const raw = String(value || '').trim();
    const parsed = parseCommandLine(raw);
    return {
        command: parsed.command,
        args: expandGlobsInArgs(parsed.args),
        raw: parsed.raw,
    };
}
