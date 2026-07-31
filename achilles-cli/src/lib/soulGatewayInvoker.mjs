export const SOUL_GATEWAY_PROVIDER_KEY = 'soul_gateway';

const AUXILIARY_METHODS = [
    'getSupportedModels',
    'listAvailableModels',
    'getLastInvocationDetails',
    'describe',
];

function qualifyGeneratedLocalModel(model) {
    if (typeof model !== 'string') return model;
    if (!model.trim()) return model;
    // This is a trusted routing hint consumed by AgentLib. AgentLib removes
    // exactly this prefix before constructing the Router request body, so the
    // caller's opaque model id remains unchanged on the wire.
    return `${SOUL_GATEWAY_PROVIDER_KEY}/${model}`;
}

export function createSoulGatewayInvoker(baseInvoker, options = {}) {
    if (typeof baseInvoker !== 'function') {
        throw new TypeError('createSoulGatewayInvoker requires an invoker function.');
    }

    const generatedLocalDescriptor = options.generatedLocalDescriptor || null;
    if (generatedLocalDescriptor && typeof options.isVerifiedGeneratedLocalRouterDescriptor !== 'function') {
        throw new TypeError('createSoulGatewayInvoker requires the AgentLib descriptor-brand verifier.');
    }
    if (generatedLocalDescriptor
        && !options.isVerifiedGeneratedLocalRouterDescriptor(generatedLocalDescriptor)) {
        throw new TypeError('createSoulGatewayInvoker rejects unverified generated-local descriptors.');
    }

    const invoker = (invocation = {}) => {
        if (generatedLocalDescriptor) {
            const protectedNames = [
                'providerKey',
                'baseURL',
                'apiKey',
                'apiKeyEnv',
                'headers',
                'transport',
            ];
            const override = protectedNames.find((name) => Object.hasOwn(invocation, name));
            if (override) {
                const error = new Error(`Generated-local invocation cannot define protected property "${override}".`);
                error.code = 'PLOINKY_GENERATED_LOCAL_OVERRIDE';
                throw error;
            }
            const generatedInvocation = {
                ...invocation,
                model: qualifyGeneratedLocalModel(invocation.model),
            };
            return baseInvoker(generatedInvocation);
        }
        return baseInvoker({
            ...invocation,
            providerKey: SOUL_GATEWAY_PROVIDER_KEY,
        });
    };

    for (const methodName of AUXILIARY_METHODS) {
        if (typeof baseInvoker[methodName] === 'function') {
            invoker[methodName] = (...args) => baseInvoker[methodName](...args);
        }
    }

    return invoker;
}
