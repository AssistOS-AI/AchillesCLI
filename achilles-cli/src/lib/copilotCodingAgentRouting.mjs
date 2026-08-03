const TASK_INTENT = /\b(?:ask|assign|build|complete|create|debug|delegate|edit|execute|fix|have|implement|inspect|invoke|launch|make|modify|perform|refactor|review|route|run|tell|test|use|write)\b/i;

const FIXED_CODING_AGENT_ROUTES = Object.freeze([
    {
        skill: 'launch-codex',
        target: /\b(?:codexAgent|codex)\b/i,
    },
    {
        skill: 'launch-opencode',
        target: /\b(?:opencodeAgent|opencode|open\s+code)\b/i,
    },
    {
        skill: 'launch-pi',
        target: /\b(?:piAgent|pi\s+coding\s+agent)\b/i,
    },
]);

export function resolveCopilotCodingAgentLauncher(prompt) {
    const text = typeof prompt === 'string' ? prompt.trim() : '';
    if (!text || !TASK_INTENT.test(text)) return null;
    return FIXED_CODING_AGENT_ROUTES.find((route) => route.target.test(text))?.skill || null;
}

export const __testables = {
    FIXED_CODING_AGENT_ROUTES,
    TASK_INTENT,
};
