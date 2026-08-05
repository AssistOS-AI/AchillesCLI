import { runOpenCodeOperation } from '../scripts/opencode-runner.mjs';

const SOUL_MODELS = new Set(['fast', 'plan', 'deep']);
const SILENT_LOG_STREAM = Object.freeze({ write() {} });

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

function managedModel(requestedModel) {
    const requested = String(requestedModel || '').trim();
    const [provider, model] = requested.split('/');
    return provider === 'soul' && SOUL_MODELS.has(model)
        ? requested
        : 'soul/fast';
}

function invalidRequest(message) {
    const error = new Error(message);
    error.code = 'PLOINKY_PROVIDER_RUNTIME_INPUT_INVALID';
    throw error;
}

export async function executeChatCompletion(payload, { providerRuntime } = {}) {
    const request = extractOpenAiRequest(payload);
    const requestedModel = typeof request?.model === 'string' ? request.model.trim() : '';
    const messages = Array.isArray(request?.messages) ? request.messages : [];
    const prompt = messagesToPrompt(messages);

    if (!requestedModel) {
        invalidRequest('model is required and must be an OpenCode model id.');
    }

    if (!prompt) {
        invalidRequest('at least one text message is required.');
    }

    const model = managedModel(requestedModel);
    let result;
    try {
        result = await runOpenCodeOperation({
            args: ['run', '--auto', '--model', model, prompt],
            providerRuntime,
            logStream: SILENT_LOG_STREAM,
        });
    } catch (error) {
        if (error?.code === 'PLOINKY_PROVIDER_RUNTIME_REQUIRED') throw error;
        return {
            ok: false,
            code: error?.code || 'PLOINKY_PROVIDER_OPERATION_FAILED',
            error: error?.message || 'OpenCode chat operation failed',
        };
    }

    if (result.code !== 0 || result.signal) {
        return {
            ok: true,
            response: openAiCompletion({
                model,
                content: failureContent(
                    result.signal
                        ? `OpenCode operation ended with signal ${result.signal}.`
                        : `OpenCode operation failed with exit code ${result.code ?? 'unknown'}.`,
                    { output: result.outputText },
                ),
            }),
        };
    }

    return {
        ok: true,
        response: openAiCompletion({
            model,
            content: result.outputText || 'OpenCode operation completed.',
        }),
    };
}

export const __testables = Object.freeze({ managedModel });
