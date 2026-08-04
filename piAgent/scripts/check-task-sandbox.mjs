const PROVIDER_SANDBOX_MODULE = '/Agent/lib/providerSandbox.mjs';
const PROVIDER = 'pi';

let providerSandboxPromise;

function assertProviderSandbox(module) {
    if (!module || typeof module !== 'object'
        || module.PROVIDER_SANDBOX_MODES?.READINESS !== 'readiness'
        || typeof module.spawnProviderSandbox !== 'function') {
        throw new TypeError('the canonical provider sandbox readiness API is unavailable');
    }
    return module;
}

async function loadProviderSandbox(dependencies = {}) {
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
        throw new TypeError('provider readiness dependencies must be an object');
    }
    const prototype = Object.getPrototypeOf(dependencies);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('provider readiness dependencies must be a plain object');
    }
    for (const name of Reflect.ownKeys(dependencies)) {
        if (name !== 'providerSandbox') {
            throw new TypeError(`unsupported provider readiness dependency ${String(name)}`);
        }
    }
    if (Object.hasOwn(dependencies, 'providerSandbox')) {
        const descriptor = Object.getOwnPropertyDescriptor(dependencies, 'providerSandbox');
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError('providerSandbox dependency must be a data property');
        }
        return assertProviderSandbox(descriptor.value);
    }
    providerSandboxPromise ||= import('/Agent/lib/providerSandbox.mjs');
    return assertProviderSandbox(await providerSandboxPromise);
}

function readinessFailure(result) {
    const signal = result?.signal ? ` signal ${result.signal}` : '';
    const error = new Error(
        `PI provider readiness failed with exit code ${result?.code ?? 'unknown'}${signal}`,
    );
    error.code = 'PLOINKY_PROVIDER_READINESS_FAILED';
    return error;
}

export async function checkTaskSandboxReadiness({
    credentialContext,
    lifecycle = {},
    dependencies = {},
} = {}) {
    if (credentialContext === null || credentialContext === undefined) {
        throw new TypeError('PI provider readiness requires credentialContext');
    }
    const providerSandbox = await loadProviderSandbox(dependencies);
    const runtime = await providerSandbox.spawnProviderSandbox({
        mode: providerSandbox.PROVIDER_SANDBOX_MODES.READINESS,
        provider: PROVIDER,
        credentialContext,
    }, lifecycle);
    const result = await runtime.completion;
    if (result?.code !== 0 || result?.signal) throw readinessFailure(result);
    return Object.freeze({ launch: runtime.launch, result });
}

export const __testables = Object.freeze({
    PROVIDER,
    PROVIDER_SANDBOX_MODULE,
});
