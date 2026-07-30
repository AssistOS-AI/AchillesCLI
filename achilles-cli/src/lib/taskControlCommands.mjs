import { controlTaskSession } from './taskSessionControl.mjs';

const TASK_ID_RE = /^task_[0-9a-f]{24}$/;
const TERMINAL_LOGIN_STATUSES = new Set(['completed', 'failed', 'cancelled']);

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

function challengeDetail(flow) {
    const challenge = flow?.challenge || {};
    return [
        challenge.url || challenge.verificationUri || '',
        challenge.userCode ? `Code: ${challenge.userCode}` : '',
        challenge.instructions || challenge.message || '',
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
    const scopedInteractions = (taskId, targetTabId = '') => ({
        select: (request, options) => interactions.select({
            ...request,
            targetTaskId: assertTaskId(taskId),
            ...(targetTabId ? { targetTabId } : {}),
        }, options),
        input: (request, options) => interactions.input({
            ...request,
            targetTaskId: assertTaskId(taskId),
            ...(targetTabId ? { targetTabId } : {}),
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
        const catalog = await call(taskId, 'login_describe');
        const providers = Array.isArray(catalog.providers) ? catalog.providers : [];
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
        let flow = initialFlow;
        while (!TERMINAL_LOGIN_STATUSES.has(flow?.status)) {
            if (flow?.status === 'waiting' && flow.prompt) {
                const prompt = flow.prompt;
                const options = Array.isArray(prompt.options) ? prompt.options : [];
                const response = options.length
                    ? await ui.select({
                        title: 'Provider authentication',
                        message: prompt.message || 'Choose a response.',
                        options: options.map((entry) => ({
                            value: String(entry.value ?? entry.id ?? ''),
                            label: String(entry.label || entry.value || entry.id || ''),
                            description: String(entry.description || ''),
                        })),
                    }, { signal })
                    : await ui.input({
                        title: 'Provider authentication',
                        message: prompt.message || 'Authentication input required.',
                        placeholder: prompt.placeholder || '',
                        type: prompt.type === 'secret' ? 'secret' : 'text',
                    }, { signal });
                flow = await call(taskId, 'login_respond', {
                    flowId: flow.flowId,
                    ...(prompt.type === 'secret' ? { secretResponse: response } : { response }),
                });
                continue;
            }
            if (flow?.challenge) {
                const action = await ui.select({
                    title: 'Complete provider authentication',
                    message: 'Finish the provider flow, then check its status.',
                    detail: challengeDetail(flow),
                    options: [
                        { value: 'check', label: 'Check status' },
                        { value: 'cancel', label: 'Cancel', tone: 'danger' },
                    ],
                }, { signal });
                if (action === 'cancel') return call(taskId, 'login_cancel', { flowId: flow.flowId });
            } else {
                await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
            }
            flow = await call(taskId, 'login_status', { flowId: flow.flowId });
        }
        return flow;
    }

    async function login(taskId, providerKey = '', methodKey = '', { signal, context } = {}) {
        const ui = scopedInteractions(taskId, context?.sourceTabId);
        const { provider } = await chooseProvider(taskId, providerKey, signal, ui);
        const method = await chooseMethod(provider, methodKey, signal, ui);
        const credentials = await collectInputs(provider, method, signal, ui);
        const flow = await call(taskId, 'login_start', {
            provider: provider.key,
            method: method.key,
            inputs: credentials.inputs,
            ...(credentials.apiKey ? { apiKey: credentials.apiKey } : {}),
        });
        const completed = await followFlow(taskId, flow, signal, ui);
        if (completed?.status === 'failed') throw new Error(completed.error || 'provider_login_failed');
        if (completed?.status === 'cancelled') throw new Error('provider_login_cancelled');
        return completed;
    }

    return { model, login };
}

export const __testables = { challengeDetail, promptIsEnabled };
