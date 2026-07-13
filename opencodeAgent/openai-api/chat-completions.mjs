#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContainerLogStream, executeOpenCodeTask } from '../scripts/opencode-runner.mjs';

function completionId() {
    return `chatcmpl-opencode-${Date.now().toString(36)}`;
}

function unixSeconds() {
    return Math.floor(Date.now() / 1000);
}

export function openAiCompletion({ model, content }) {
    return {
        id: completionId(),
        object: 'chat.completion',
        created: unixSeconds(),
        model,
        choices: [
            {
                index: 0,
                message: {
                    role: 'assistant',
                    content,
                },
                finish_reason: 'stop',
            },
        ],
        usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        },
    };
}

async function readStdinJson() {
    process.stdin.setEncoding('utf8');
    let raw = '';
    for await (const chunk of process.stdin) {
        raw += chunk;
    }
    if (!raw.trim()) return {};
    return JSON.parse(raw);
}

function extractOpenAiRequest(payload) {
    const envelope = payload?.input && typeof payload.input === 'object'
        ? payload.input
        : payload;
    return envelope?.request && typeof envelope.request === 'object'
        ? envelope.request
        : envelope;
}

function contentPartToText(part) {
    if (typeof part === 'string') return part;
    if (!part || typeof part !== 'object') return '';
    if (typeof part.text === 'string') return part.text;
    if (part.type === 'text' && typeof part.content === 'string') return part.content;
    return '';
}

function messageContentToText(content) {
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
        return content
            .map(contentPartToText)
            .filter(Boolean)
            .join('\n')
            .trim();
    }
    if (content && typeof content === 'object' && typeof content.text === 'string') {
        return content.text.trim();
    }
    return '';
}

function formatRole(role) {
    if (role === 'system') return 'System';
    if (role === 'developer') return 'Developer';
    if (role === 'assistant') return 'Assistant';
    return 'User';
}

export function messagesToPrompt(messages) {
    return messages
        .map((message) => {
            const text = messageContentToText(message?.content);
            if (!text) return '';
            return `${formatRole(message?.role)}:\n${text}`;
        })
        .filter(Boolean)
        .join('\n\n')
        .trim();
}

function failureContent(message, details = {}) {
    const extra = Object.entries(details)
        .filter(([, value]) => value)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');
    return extra ? `OpenCode task failed: ${message}\n${extra}` : `OpenCode task failed: ${message}`;
}

export async function handleChatCompletions(payload, {
    env = process.env,
    logStream = createContainerLogStream(),
} = {}) {
    const request = extractOpenAiRequest(payload);
    const model = typeof request?.model === 'string' ? request.model.trim() : '';
    const messages = Array.isArray(request?.messages) ? request.messages : [];
    const prompt = messagesToPrompt(messages);
    const projectDir = typeof env.WORKSPACE_PATH === 'string' ? env.WORKSPACE_PATH.trim() : '';

    if (!model) {
        return openAiCompletion({
            model,
            content: failureContent('model is required and must be an OpenCode model id.'),
        });
    }

    if (!prompt) {
        return openAiCompletion({
            model,
            content: failureContent('at least one text message is required.'),
        });
    }

    if (!projectDir) {
        return openAiCompletion({
            model,
            content: failureContent('WORKSPACE_PATH is not configured for opencodeAgent.'),
        });
    }

    const result = await executeOpenCodeTask({
        prompt,
        projectDir,
        model,
        logStream,
        env,
        createProjectDir: false,
        logPrefix: 'chat-completions',
    });

    if (!result.ok) {
        return openAiCompletion({
            model,
            content: failureContent(result.error || 'OpenCode task failed.', {
                output: result.outputText,
            }),
        });
    }

    return openAiCompletion({
        model,
        content: result.outputText || 'OpenCode task completed.',
    });
}

async function main() {
    const payload = await readStdinJson();
    const completion = await handleChatCompletions(payload);
    process.stdout.write(JSON.stringify(completion));
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
    main().catch((error) => {
        process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
        process.exitCode = 1;
    });
}
