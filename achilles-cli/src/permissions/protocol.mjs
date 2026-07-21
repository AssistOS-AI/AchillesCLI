export const PERMISSION_MODES = Object.freeze({
    ASK: 'ask-for-approval',
    FULL: 'full-access',
});

export const APPROVAL_DECISIONS = Object.freeze({
    ALLOW: 'allow',
    DENY: 'deny',
    ALWAYS_ALLOW: 'always allow',
});

export const WEBCHAT_INTERACTION_OPTIONS = Object.freeze({
    ALWAYS_ALLOW: 'always-allow',
    ALLOW: 'allow',
    DENY: 'deny',
});

const WEBCHAT_INTERACTION_FLAG = '__webchatInteraction';
const WEBCHAT_INTERACTION_RESOLVED_FLAG = '__webchatInteractionResolved';
const WEBCHAT_INTERACTION_RESPONSE_FLAG = '__webchatInteractionResponse';
const INTERACTION_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

export function normalizePermissionMode(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === PERMISSION_MODES.ASK || normalized === 'ask') {
        return PERMISSION_MODES.ASK;
    }
    if (normalized === PERMISSION_MODES.FULL || normalized === 'full') {
        return PERMISSION_MODES.FULL;
    }
    return null;
}

export function normalizeApprovalDecision(value) {
    const normalized = String(value || '').trim().toLowerCase().replace(/[-_]+/g, ' ');
    if (['allow', 'yes', 'y'].includes(normalized)) {
        return APPROVAL_DECISIONS.ALLOW;
    }
    if (['deny', 'no', 'n'].includes(normalized)) {
        return APPROVAL_DECISIONS.DENY;
    }
    if (['always allow', 'always', 'all', 'a'].includes(normalized)) {
        return APPROVAL_DECISIONS.ALWAYS_ALLOW;
    }
    return null;
}

export function approvalDecisionFromInteractionOption(value) {
    const optionId = String(value || '').trim().toLowerCase();
    if (optionId === WEBCHAT_INTERACTION_OPTIONS.ALWAYS_ALLOW) {
        return APPROVAL_DECISIONS.ALWAYS_ALLOW;
    }
    return normalizeApprovalDecision(optionId);
}

export function createWebchatApprovalInteraction({ id, params, escalation = false } = {}) {
    if (!INTERACTION_ID_RE.test(String(id || ''))) {
        throw new Error('A valid interaction id is required.');
    }
    const command = String(params?.raw || params?.command || '').trim();
    return {
        [WEBCHAT_INTERACTION_FLAG]: 1,
        version: 1,
        id,
        kind: 'approval',
        title: 'Bash approval required',
        message: escalation
            ? 'The command could not complete inside the workspace sandbox and requests access outside it.'
            : 'The Bash tool requests permission to execute this command.',
        detail: command ? `$ ${command}` : '(command unavailable)',
        options: [
            { id: WEBCHAT_INTERACTION_OPTIONS.ALWAYS_ALLOW, label: 'Always approve' },
            { id: WEBCHAT_INTERACTION_OPTIONS.ALLOW, label: 'Allow' },
            { id: WEBCHAT_INTERACTION_OPTIONS.DENY, label: 'Deny', tone: 'danger' },
        ],
        defaultOptionId: WEBCHAT_INTERACTION_OPTIONS.ALWAYS_ALLOW,
    };
}

export function createWebchatInteractionResolved({ id, optionId = null, status = 'resolved' } = {}) {
    return {
        [WEBCHAT_INTERACTION_RESOLVED_FLAG]: 1,
        version: 1,
        id,
        optionId,
        status,
    };
}

export function parseWebchatInteractionResponse(raw) {
    const text = String(raw || '').trim();
    if (!text || !text.includes(`"${WEBCHAT_INTERACTION_RESPONSE_FLAG}"`)) {
        return null;
    }
    try {
        const parsed = JSON.parse(text);
        if (!parsed?.[WEBCHAT_INTERACTION_RESPONSE_FLAG] || parsed.version !== 1) {
            return null;
        }
        const id = typeof parsed.id === 'string' ? parsed.id.trim() : '';
        const optionId = typeof parsed.optionId === 'string' ? parsed.optionId.trim() : '';
        if (!INTERACTION_ID_RE.test(id) || !approvalDecisionFromInteractionOption(optionId)) {
            return null;
        }
        return { id, optionId };
    } catch {
        return null;
    }
}

export function stableSerialize(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
    }
    const entries = Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`);
    return `{${entries.join(',')}}`;
}

export function buildApprovalKey(toolName, params) {
    return stableSerialize({ toolName: String(toolName || ''), params });
}

export function formatApprovalPrompt({ params, escalation = false } = {}) {
    const command = String(params?.raw || params?.command || '').trim();
    const reason = escalation
        ? 'The command could not complete inside the workspace sandbox and requests access outside it.'
        : 'The Bash tool requests permission to execute this command.';
    return [
        'Bash approval required',
        reason,
        command ? `$ ${command}` : '(command unavailable)',
        'Reply with: allow, deny, or always allow.',
    ].join('\n');
}
