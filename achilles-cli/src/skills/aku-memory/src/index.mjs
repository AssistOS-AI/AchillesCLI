import { AkuMemoryAdapter } from '../../../lib/akuMemory/AkuMemoryAdapter.mjs';

export async function action(invocation = {}) {
    const request = parseRequest(invocation.promptText);
    const context = invocation.context || invocation.mainAgent?.context || {};
    const adapter = context.akuMemoryAdapter instanceof AkuMemoryAdapter
        ? context.akuMemoryAdapter
        : new AkuMemoryAdapter({
            rootDir: context.workspaceRoot || context.workingDir || process.cwd(),
            workspaceRoot: context.workspaceRoot || context.workingDir || process.cwd(),
            actor: 'achilles-cli',
            sessionState: context.akuSessionState,
            logger: invocation.mainAgent?.logger,
        });

    const result = await adapter.executeAction(request, {
        intentPlan: context.akuMemoryPreflight?.intentPlan,
    });
    return JSON.stringify(result, null, 2);
}

function parseRequest(promptText) {
    if (promptText && typeof promptText === 'object') {
        return promptText;
    }
    const text = String(promptText ?? '').trim();
    if (!text) {
        return {};
    }
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {
            operation: 'resolve',
            query: text,
        };
    }
}

export default action;
