import { controlTaskSession } from './taskSessionControl.mjs';

const TASK_ID_RE = /^task_[0-9a-f]{24}$/;
const TERMINAL_LOGIN_STATUSES = new Set(['completed', 'failed', 'cancelled', 'expired']);
const LOGIN_METHOD_KINDS = new Set([
    'api_key',
    'access_token',
    'credential_form',
    'device_code',
    'manual_oauth_code',
]);
const LOGIN_FLOW_STATUSES = new Set(['running', 'waiting', ...TERMINAL_LOGIN_STATUSES]);
const LOGIN_ERROR_CODES = new Set([
    'provider_login_failed',
    'provider_login_output_invalid',
    'provider_login_completion_failed',
    'provider_login_response_failed',
]);
const FLOW_ID_RE = /^login:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTINUATION_HANDLE_RE = /^[A-Za-z0-9_-]{43}$/;
const PROMPT_NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const PROVIDER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

function assertTaskId(taskId) {
    const value = String(taskId || '').trim();
    if (!TASK_ID_RE.test(value)) throw new Error('invalid_task_id');
    return value;
}

function findByKey(values, key, errorCode) {
    const normalized = String(key || '').trim();
    const found = values.find((entry) => entry?.key === normalized);
    if (!found) throw new Error(errorCode);
    return found;
}

function compactText(value, limit) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function httpUrl(value) {
    const candidate = String(value || '').trim();
    if (!candidate) return '';
    try {
        const parsed = new URL(candidate);
        const host = parsed.hostname.toLowerCase();
        const loopback = host === 'localhost' || host.endsWith('.localhost')
            || host === '::1' || host === '[::1]' || host === '0.0.0.0' || /^127(?:\.|$)/.test(host);
        return parsed.protocol === 'https:' && !loopback ? parsed.toString() : '';
    } catch (_) {
        return '';
    }
}

function normalizeMethodPrompt(raw) {
    const key = String(raw?.key || '').trim();
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(key)) return null;
    const options = Array.isArray(raw.options) ? raw.options.slice(0, 100).map((entry) => {
        const value = String(entry?.value ?? entry?.id ?? '').trim().slice(0, 1000);
        const label = compactText(entry?.label || value, 200);
        if (!value || !label) return null;
        return { value, label, description: compactText(entry?.description || entry?.hint, 500) };
    }).filter(Boolean) : [];
    const whenKey = String(raw?.when?.key || '').trim();
    const when = /^[A-Za-z0-9_.-]{1,100}$/.test(whenKey)
        && (raw.when.op === 'eq' || raw.when.op === 'neq')
        ? { key: whenKey, op: raw.when.op, value: String(raw.when.value ?? '').slice(0, 1000) }
        : null;
    return {
        key,
        message: compactText(raw.message || `Enter ${key}.`, 500),
        placeholder: compactText(raw.placeholder, 300),
        secret: raw.secret === true || raw.type === 'secret',
        ...(options.length ? { options } : {}),
        ...(when ? { when } : {}),
    };
}

export function normalizeLoginCatalog(raw) {
    const providers = Array.isArray(raw?.providers) ? raw.providers : [];
    return providers.slice(0, 200).map((provider) => {
        const key = String(provider?.key || '').trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(key)) return null;
        const methods = (Array.isArray(provider.methods) ? provider.methods : []).slice(0, 50).map((method) => {
            const methodKey = String(method?.key || '').trim();
            const kind = String(method?.kind || '').trim();
            if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(methodKey)
                || !LOGIN_METHOD_KINDS.has(kind)) return null;
            const prompts = (Array.isArray(method.prompts) ? method.prompts : [])
                .map(normalizeMethodPrompt)
                .filter(Boolean);
            return {
                key: methodKey,
                kind,
                label: compactText(method.label || methodKey, 200),
                secret: method.secret === true,
                ...(prompts.length ? { prompts } : {}),
            };
        }).filter(Boolean);
        if (!methods.length) return null;
        return { key, label: compactText(provider.label || key, 200), methods };
    }).filter(Boolean);
}

export function normalizeLoginChallenge(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('invalid_provider_login_challenge');
    }
    const keys = Object.keys(raw);
    const type = String(raw.type || '');
    if (type === 'device_code') {
        if (keys.some((key) => !['type', 'verificationUri', 'userCode'].includes(key))) {
            throw new Error('invalid_provider_login_challenge');
        }
        const verificationUri = httpUrl(raw.verificationUri);
        const userCode = String(raw.userCode || '');
        if (!verificationUri || !/^[A-Za-z0-9-]{4,64}$/.test(userCode)) {
            throw new Error('invalid_provider_login_challenge');
        }
        return {
            type,
            verificationUri,
            userCode,
        };
    }
    if (type === 'authorization_url') {
        if (keys.some((key) => !['type', 'verificationUri'].includes(key))) {
            throw new Error('invalid_provider_login_challenge');
        }
        const verificationUri = httpUrl(raw.verificationUri);
        if (!verificationUri) throw new Error('invalid_provider_login_challenge');
        return { type, verificationUri };
    }
    throw new Error('unsupported_provider_login_challenge');
}

function normalizeLoginPrompt(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || Object.keys(raw).some((key) => !['type', 'seq', 'nonce'].includes(key))
        || (raw.type !== 'manual_code' && raw.type !== 'manual_callback')
        || !Number.isSafeInteger(raw.seq) || raw.seq < 1
        || typeof raw.nonce !== 'string' || !PROMPT_NONCE_RE.test(raw.nonce)) {
        throw new Error('invalid_provider_login_prompt');
    }
    return { type: raw.type, seq: raw.seq, nonce: raw.nonce };
}

export function normalizeLoginFlow(raw) {
    const allowed = new Set([
        'type', 'version', 'flowId', 'continuationHandle', 'provider', 'method',
        'status', 'challenge', 'prompt', 'error',
    ]);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || Object.keys(raw).some((key) => !allowed.has(key))
        || raw.type !== 'login-flow' || raw.version !== 1
        || !LOGIN_FLOW_STATUSES.has(raw.status)
        || typeof raw.provider !== 'string' || !PROVIDER_NAME_RE.test(raw.provider)
        || typeof raw.method !== 'string' || !PROVIDER_NAME_RE.test(raw.method)) {
        throw new Error('invalid_provider_login_flow');
    }
    const terminal = TERMINAL_LOGIN_STATUSES.has(raw.status);
    const hasControl = raw.flowId !== undefined || raw.continuationHandle !== undefined;
    if ((!terminal || hasControl)
        && (!FLOW_ID_RE.test(String(raw.flowId || ''))
            || !CONTINUATION_HANDLE_RE.test(String(raw.continuationHandle || '')))) {
        throw new Error('invalid_provider_login_flow');
    }
    if (terminal && (raw.challenge !== undefined || raw.prompt !== undefined)) {
        throw new Error('invalid_provider_login_flow');
    }
    if (raw.status === 'waiting' && raw.prompt === undefined) {
        throw new Error('invalid_provider_login_flow');
    }
    if (raw.status !== 'waiting' && raw.prompt !== undefined) {
        throw new Error('invalid_provider_login_flow');
    }
    if (raw.status === 'failed') {
        if (!LOGIN_ERROR_CODES.has(raw.error)) throw new Error('invalid_provider_login_flow');
    } else if (raw.error !== undefined) {
        throw new Error('invalid_provider_login_flow');
    }
    return Object.freeze({
        type: 'login-flow',
        version: 1,
        ...(hasControl ? {
            flowId: raw.flowId,
            continuationHandle: raw.continuationHandle,
        } : {}),
        provider: raw.provider,
        method: raw.method,
        status: raw.status,
        ...(raw.challenge !== undefined ? { challenge: normalizeLoginChallenge(raw.challenge) } : {}),
        ...(raw.prompt !== undefined ? { prompt: normalizeLoginPrompt(raw.prompt) } : {}),
        ...(raw.error !== undefined ? { error: raw.error } : {}),
    });
}

function challengeDetail(flow) {
    const challenge = flow?.challenge || {};
    return [
        challenge.verificationUri || '',
        challenge.userCode ? `Code: ${challenge.userCode}` : '',
    ].filter(Boolean).join('\n');
}

function promptIsEnabled(prompt, inputs) {
    const condition = prompt?.when;
    if (!condition) return true;
    const actual = String(inputs?.[condition.key] || '');
    if (condition.op === 'eq') return actual === String(condition.value);
    if (condition.op === 'neq') return actual !== String(condition.value);
    return true;
}

export function createTaskControlCommands({
    workingDir,
    interactions,
    controlTaskSessionImpl = controlTaskSession,
    setTaskModelImpl,
    onLoginCompleted,
    pollIntervalMs = 500,
} = {}) {
    if (!workingDir) throw new Error('workingDir is required');
    if (!interactions?.select || !interactions?.input) throw new Error('interactions are required');

    const call = (taskId, operation, args = {}) => controlTaskSessionImpl({
        dir: workingDir,
        taskId: assertTaskId(taskId),
        operation,
        ...args,
    }, setTaskModelImpl ? { setTaskModelImpl } : {});
    const scopedInteractions = (taskId, targetTabId = '', targetPageInstanceId = '') => ({
        select: (request, options) => interactions.select({
            ...request,
            targetTaskId: assertTaskId(taskId),
            ...(targetTabId ? { targetTabId } : {}),
            ...(targetPageInstanceId ? { targetPageInstanceId } : {}),
        }, options),
        input: (request, options) => interactions.input({
            ...request,
            targetTaskId: assertTaskId(taskId),
            ...(targetTabId ? { targetTabId } : {}),
            ...(targetPageInstanceId ? { targetPageInstanceId } : {}),
        }, options),
    });

    async function model(taskId, modelKey = '', { signal, context } = {}) {
        const catalog = await call(taskId, 'list_models');
        const models = Array.isArray(catalog.models) ? catalog.models : [];
        if (!models.length) throw new Error('task_model_catalog_empty');
        const selectedKey = String(modelKey || '').trim();
        if (!selectedKey) return catalog;
        return call(taskId, 'set_model', { modelKey: selectedKey });
    }

    async function chooseProvider(taskId, requestedProvider, signal, ui) {
        const rawCatalog = await call(taskId, 'login_describe');
        const providers = normalizeLoginCatalog(rawCatalog);
        const catalog = { ...rawCatalog, providers };
        if (!providers.length) throw new Error('task_login_catalog_empty');
        if (requestedProvider) return { catalog, provider: findByKey(providers, requestedProvider, 'task_login_provider_unavailable') };
        const key = await ui.select({
            title: 'Connect provider',
            message: 'Choose a provider to configure in the task agent.',
            options: providers.map((entry) => ({ value: entry.key, label: entry.label || entry.key, description: entry.key })),
            searchable: providers.length > 8,
        }, { signal });
        return { catalog, provider: findByKey(providers, key, 'task_login_provider_unavailable') };
    }

    async function chooseMethod(provider, requestedMethod, signal, ui) {
        const methods = Array.isArray(provider.methods) ? provider.methods : [];
        if (!methods.length) throw new Error('task_login_methods_empty');
        if (requestedMethod) return findByKey(methods, requestedMethod, 'task_login_method_unavailable');
        const key = await ui.select({
            title: `Connect ${provider.label || provider.key}`,
            message: 'Choose the authentication method.',
            options: methods.map((entry) => ({ value: entry.key, label: entry.label || entry.key, description: entry.key })),
        }, { signal });
        return findByKey(methods, key, 'task_login_method_unavailable');
    }

    async function collectInputs(provider, method, signal, ui) {
        const inputs = {};
        for (const prompt of Array.isArray(method.prompts) ? method.prompts : []) {
            if (!promptIsEnabled(prompt, inputs)) continue;
            const key = String(prompt?.key || '').trim();
            if (!/^[A-Za-z0-9_.-]{1,100}$/.test(key)) throw new Error('invalid_provider_input_key');
            const options = Array.isArray(prompt.options) ? prompt.options : [];
            if (options.length) {
                inputs[key] = await ui.select({
                    title: provider.label || provider.key,
                    message: prompt.message || `Choose ${key}.`,
                    options: options.map((entry) => ({
                        value: String(entry.value ?? entry.id ?? ''),
                        label: String(entry.label || entry.value || entry.id || ''),
                        description: String(entry.description || ''),
                    })),
                }, { signal });
            } else {
                inputs[key] = await ui.input({
                    title: provider.label || provider.key,
                    message: prompt.message || `Enter ${key}.`,
                    placeholder: prompt.placeholder || '',
                    type: prompt.secret === true ? 'secret' : 'text',
                }, { signal });
            }
        }
        const apiKey = method.secret === true
            ? await ui.input({
                title: `Connect ${provider.label || provider.key}`,
                message: `Enter ${method.label || method.key}.`,
                type: 'secret',
                maxLength: 65536,
            }, { signal })
            : '';
        return { inputs, apiKey };
    }

    async function followFlow(taskId, initialFlow, signal, ui) {
        const acceptFlow = async (raw) => {
            try {
                return normalizeLoginFlow(raw);
            } catch (error) {
                const flowId = String(raw?.flowId || '').trim();
                const continuationHandle = String(raw?.continuationHandle || '').trim();
                if (FLOW_ID_RE.test(flowId) && CONTINUATION_HANDLE_RE.test(continuationHandle)) {
                    await call(taskId, 'login_cancel', { flowId, continuationHandle }).catch(() => {});
                }
                throw error;
            }
        };
        const monitorChallenge = async (initialChallengeFlow) => {
            let currentFlow = initialChallengeFlow;
            const promptController = new AbortController();
            const forwardAbort = () => promptController.abort();
            if (signal?.aborted) throw new Error('interaction_cancelled');
            signal?.addEventListener?.('abort', forwardAbort, { once: true });
            const selection = ui.select({
                title: 'Complete provider authentication',
                message: 'Finish the provider flow. This menu closes automatically when authentication succeeds.',
                detail: challengeDetail(currentFlow),
                challenge: currentFlow.challenge,
                options: [
                    { value: 'cancel', label: 'Cancel', tone: 'danger' },
                ],
            }, { signal: promptController.signal }).then(
                (action) => ({ type: 'action', action }),
                (error) => ({ type: 'interaction-error', error }),
            );
            try {
                while (!TERMINAL_LOGIN_STATUSES.has(currentFlow?.status)) {
                    const next = await Promise.race([
                        selection,
                        new Promise((resolve) => setTimeout(
                            () => resolve({ type: 'poll' }),
                            pollIntervalMs,
                        )),
                    ]);
                    if (next.type === 'interaction-error') throw next.error;
                    if (next.type === 'action') {
                        if (next.action !== 'cancel') throw new Error('invalid_provider_login_action');
                        return acceptFlow(await call(taskId, 'login_cancel', {
                            flowId: currentFlow.flowId,
                            continuationHandle: currentFlow.continuationHandle,
                        }));
                    }
                    const previousChallenge = JSON.stringify(currentFlow.challenge || null);
                    currentFlow = await acceptFlow(await call(taskId, 'login_status', {
                        flowId: currentFlow.flowId,
                        continuationHandle: currentFlow.continuationHandle,
                    }));
                    if (JSON.stringify(currentFlow.challenge || null) !== previousChallenge) {
                        return currentFlow;
                    }
                }
                return currentFlow;
            } finally {
                signal?.removeEventListener?.('abort', forwardAbort);
                promptController.abort();
                await selection;
            }
        };
        let flow = await acceptFlow(initialFlow);
        while (!TERMINAL_LOGIN_STATUSES.has(flow?.status)) {
            if (flow?.status === 'waiting' && flow.prompt) {
                const prompt = flow.prompt;
                const response = await ui.input({
                    title: 'Provider authentication',
                    message: prompt.type === 'manual_callback'
                        ? 'Paste the provider callback response.'
                        : 'Enter the provider authorization code.',
                    type: 'secret',
                    detail: challengeDetail(flow),
                    challenge: flow.challenge || null,
                }, { signal });
                flow = await acceptFlow(await call(taskId, 'login_respond', {
                    flowId: flow.flowId,
                    continuationHandle: flow.continuationHandle,
                    seq: prompt.seq,
                    nonce: prompt.nonce,
                    response,
                }));
                continue;
            }
            if (flow?.challenge) {
                flow = await monitorChallenge(flow);
                continue;
            } else {
                await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
            }
            flow = await acceptFlow(await call(taskId, 'login_status', {
                flowId: flow.flowId,
                continuationHandle: flow.continuationHandle,
            }));
        }
        return flow;
    }

    async function login(taskId, providerKey = '', methodKey = '', { signal, context } = {}) {
        const ui = scopedInteractions(taskId, context?.sourceTabId, context?.sourcePageInstanceId);
        const { provider } = await chooseProvider(taskId, providerKey, signal, ui);
        const method = await chooseMethod(provider, methodKey, signal, ui);
        const credentials = await collectInputs(provider, method, signal, ui);
        const flow = await call(taskId, 'login_start', {
            provider: provider.key,
            method: method.key,
            inputs: credentials.inputs,
            ...(credentials.apiKey ? { apiKey: credentials.apiKey } : {}),
        });
        let completed;
        try {
            completed = await followFlow(taskId, flow, signal, ui);
        } catch (error) {
            if (error?.message === 'interaction_cancelled'
                && flow?.flowId && flow?.continuationHandle) {
                await call(taskId, 'login_cancel', {
                    flowId: flow.flowId,
                    continuationHandle: flow.continuationHandle,
                }).catch(() => {});
            }
            throw error;
        }
        if (completed?.status === 'failed') throw new Error(completed.error || 'provider_login_failed');
        if (completed?.status === 'cancelled') throw new Error('provider_login_cancelled');
        if (completed?.status === 'expired') throw new Error('provider_login_expired');
        if (completed?.status === 'completed' && typeof onLoginCompleted === 'function') {
            await onLoginCompleted(taskId, completed);
        }
        return completed;
    }

    return { model, login };
}

export const __testables = {
    LOGIN_METHOD_KINDS,
    challengeDetail,
    normalizeLoginFlow,
    promptIsEnabled,
};
