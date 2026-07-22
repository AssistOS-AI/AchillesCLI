export const SOUL_GATEWAY_PROVIDER_KEY = 'soul_gateway';

const AUXILIARY_METHODS = [
    'getSupportedModels',
    'listAvailableModels',
    'getLastInvocationDetails',
    'describe',
];

export function createSoulGatewayInvoker(baseInvoker) {
    if (typeof baseInvoker !== 'function') {
        throw new TypeError('createSoulGatewayInvoker requires an invoker function.');
    }

    const invoker = (invocation = {}) => baseInvoker({
        ...invocation,
        providerKey: SOUL_GATEWAY_PROVIDER_KEY,
    });

    for (const methodName of AUXILIARY_METHODS) {
        if (typeof baseInvoker[methodName] === 'function') {
            invoker[methodName] = (...args) => baseInvoker[methodName](...args);
        }
    }

    return invoker;
}
