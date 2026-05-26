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
        description: description.slice(0, 220),
    };
}

function buildPrompt(payload) {
    const workspaceName = String(payload.workspaceName || 'this workspace').trim() || 'this workspace';
    const workingDir = String(payload.workingDir || '').trim();
    const skills = Array.isArray(payload.skills)
        ? payload.skills.map(normalizeSkill).filter(Boolean).slice(0, 40)
        : [];

    const skillLines = skills.length
        ? skills.map((skill) => {
            const suffix = skill.description ? ` - ${skill.description}` : '';
            return `- ${skill.name} (${skill.type})${suffix}`;
        }).join('\n')
        : '- No visible skills were provided.';

    return `Generate a concise startup introduction for Achilles CLI.

Achilles CLI is an agent-style command line assistant for working inside a workspace, similar in role to tools like Codex or Gemini CLI. It can help the user inspect the current project, reason about the available workspace capabilities, and use registered skills to perform relevant work.

Workspace name: ${workspaceName}
Workspace path: ${workingDir || '(unknown)'}

Visible skills:
${skillLines}

Requirements:
- Write 1 to 3 short sentences.
- Be specific to the workspace and skill catalog when there is a clear theme.
- If the skills suggest a domain, mention the kind of work the user can start with.
- Do not list every skill unless there are only a few.
- Do not invent capabilities beyond the provided skills.
- Do not mention that you inspected JSON, prompts, metadata, or descriptors.
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
        model: 'fast',
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
