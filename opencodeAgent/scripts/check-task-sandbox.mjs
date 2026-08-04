const PROVIDER = 'opencode';

function assertPlainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be a plain object`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${label} must be a plain object`);
    }
}

function assertProviderSandboxModule(module) {
    if (!module || typeof module !== 'object'
        || typeof module.spawnProviderSandbox !== 'function'
        || module.PROVIDER_SANDBOX_MODES?.READINESS !== 'readiness') {
        throw new TypeError('canonical Ploinky provider sandbox module is invalid');
    }
    return module;
}

async function loadProviderSandboxModule(providerSandboxModule) {
    if (providerSandboxModule !== undefined) {
        return assertProviderSandboxModule(providerSandboxModule);
    }
    return assertProviderSandboxModule(await import('/Agent/lib/providerSandbox.mjs'));
}

function readinessError(result) {
    const error = new Error(
        `sandboxed OpenCode readiness failed (${result.signal
            ? `signal ${result.signal}`
            : `exit ${result.code ?? 'unknown'}`})`,
    );
    error.code = 'PLOINKY_PROVIDER_READINESS_FAILED';
    return error;
}

export async function checkTaskSandboxReadiness(
    input,
    dependencies = {},
) {
    assertPlainObject(input, 'OpenCode readiness input');
    const inputKeys = Object.keys(input);
    if (inputKeys.length !== 1 || inputKeys[0] !== 'credentialContext') {
        throw new TypeError('OpenCode readiness input requires only credentialContext');
    }
    assertPlainObject(dependencies, 'OpenCode readiness dependencies');
    for (const key of Object.keys(dependencies)) {
        if (key !== 'providerSandboxModule' && key !== 'providerSpawnDependencies') {
            throw new TypeError(`OpenCode readiness dependencies contains unknown field ${key}`);
        }
    }
    const module = await loadProviderSandboxModule(dependencies.providerSandboxModule);
    const run = await module.spawnProviderSandbox({
        mode: module.PROVIDER_SANDBOX_MODES.READINESS,
        provider: PROVIDER,
        credentialContext: input.credentialContext,
    }, {
        stdio: ['ignore', 'ignore', 'ignore'],
        leaseMetadata: { purpose: 'provider-readiness' },
    }, dependencies.providerSpawnDependencies);
    const result = await run.completion;
    if (result.code !== 0 || result.signal) throw readinessError(result);
    return Object.freeze({
        mode: module.PROVIDER_SANDBOX_MODES.READINESS,
        provider: PROVIDER,
        code: result.code,
        signal: result.signal,
    });
}
