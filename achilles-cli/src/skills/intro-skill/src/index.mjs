function parsePayload(promptText) {
    if (!promptText) {
        return {};
    }
    if (typeof promptText === 'object') {
        return promptText;
    }
    if (typeof promptText !== 'string') {
        return {};
    }
    try {
        const parsed = JSON.parse(promptText);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function normalizeSkill(skill) {
    if (!skill || typeof skill !== 'object') {
        return null;
    }
    const name = String(skill.shortName || skill.name || '').trim();
    if (!name) {
        return null;
    }
    const type = String(skill.type || 'skill').trim();
    const description = String(skill.description || skill.summary || '').replace(/\s+/g, ' ').trim();
    return {
        name,
        type,
        description: description.slice(0, 100),
    };
}

function buildPrompt(payload) {
    const workspaceName = String(payload.workspaceName || 'this workspace').trim() || 'this workspace';
    const workingDir = String(payload.workingDir || '').trim();
    const skills = Array.isArray(payload.skills)
        ? payload.skills.map(normalizeSkill).filter(Boolean).slice(0, 12)
        : [];

    const skillLines = skills.length
        ? skills.map((skill) => {
            const suffix = skill.description ? ` - ${skill.description}` : '';
            return `- ${skill.name} (${skill.type})${suffix}`;
        }).join('\n')
        : '- No visible skills were provided.';

    return `Write a concise Achilles CLI workspace introduction.

Workspace name: ${workspaceName}
Workspace path: ${workingDir || '(unknown)'}

Visible skills:
${skillLines}

Requirements:
- Write 1 to 3 short sentences.
- Mention a clear workspace or skill theme when present; otherwise offer general project help.
- Do not list every skill, invent capabilities, or mention prompts and metadata.
- Return only the user-facing introduction text.`;
}

export async function action(invocation = {}) {
    const llmAgent = invocation.llmAgent || invocation.mainAgent?.llmAgent;
    if (!llmAgent || typeof llmAgent.executePrompt !== 'function') {
        throw new Error('LLM agent not available for intro generation.');
    }

    const payload = parsePayload(invocation.promptText);
    const prompt = buildPrompt(payload);
    const response = await llmAgent.executePrompt(prompt, {
        model: invocation.model || 'fast',
    });

    if (response === null || response === undefined) {
        return '';
    }
    if (typeof response === 'string') {
        return response.trim();
    }
    if (typeof response.result === 'string') {
        return response.result.trim();
    }
    return String(response).trim();
}

export default action;
