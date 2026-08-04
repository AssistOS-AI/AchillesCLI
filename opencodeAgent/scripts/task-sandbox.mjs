const PROVIDER = 'opencode';
const EXECUTABLE = '/home/agent/.opencode/bin/opencode';

function assertPlainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be a plain object`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${label} must be a plain object`);
    }
}

function assertExactKeys(value, allowed, required, label) {
    assertPlainObject(value, label);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw new TypeError(`${label} contains unknown field ${key}`);
    }
    for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
            throw new TypeError(`${label} is missing required field ${key}`);
        }
    }
}

function normalizeDependencies(value = {}, { spawn = false } = {}) {
    const allowed = new Set(['providerSandboxModule']);
    if (spawn) allowed.add('providerSpawnDependencies');
    assertExactKeys(value, allowed, new Set(), 'OpenCode sandbox dependencies');
    return value;
}

function assertProviderSandboxModule(module) {
    if (!module || typeof module !== 'object'
        || typeof module.buildProviderSandboxPolicy !== 'function'
        || typeof module.buildProviderSandboxLaunch !== 'function'
        || typeof module.spawnProviderSandbox !== 'function'
        || module.PROVIDER_SANDBOX_MODES?.TASK !== 'task') {
        throw new TypeError('canonical Ploinky provider sandbox module is invalid');
    }
    return module;
}

async function loadProviderSandboxModule(dependencies) {
    const normalized = normalizeDependencies(dependencies);
    if (normalized.providerSandboxModule !== undefined) {
        return assertProviderSandboxModule(normalized.providerSandboxModule);
    }
    return assertProviderSandboxModule(await import('/Agent/lib/providerSandbox.mjs'));
}

function normalizeTaskInput(input) {
    assertExactKeys(
        input,
        new Set(['credentialContext', 'workdir', 'args', 'environment']),
        new Set(['credentialContext', 'workdir']),
        'OpenCode task sandbox input',
    );
    const args = input.args ?? [];
    if (!Array.isArray(args)) throw new TypeError('OpenCode task sandbox args must be an array');
    const environment = input.environment ?? {};
    assertPlainObject(environment, 'OpenCode task sandbox environment');
    return {
        credentialContext: input.credentialContext,
        workdir: input.workdir,
        command: [EXECUTABLE, ...args],
        environment,
    };
}

function canonicalTaskInput(module, input) {
    return {
        mode: module.PROVIDER_SANDBOX_MODES.TASK,
        provider: PROVIDER,
        ...normalizeTaskInput(input),
    };
}

export async function buildTaskSandboxPolicy(input, dependencies = {}) {
    const module = await loadProviderSandboxModule(dependencies);
    return module.buildProviderSandboxPolicy(canonicalTaskInput(module, input));
}

export async function buildTaskSandboxLaunch(input, dependencies = {}) {
    const module = await loadProviderSandboxModule(dependencies);
    return module.buildProviderSandboxLaunch(canonicalTaskInput(module, input));
}

export async function spawnTaskSandbox(input, lifecycle = {}, dependencies = {}) {
    assertPlainObject(lifecycle, 'OpenCode task sandbox lifecycle');
    const normalized = normalizeDependencies(dependencies, { spawn: true });
    const module = await loadProviderSandboxModule({
        ...(normalized.providerSandboxModule === undefined
            ? {}
            : { providerSandboxModule: normalized.providerSandboxModule }),
    });
    return module.spawnProviderSandbox(
        canonicalTaskInput(module, input),
        lifecycle,
        normalized.providerSpawnDependencies,
    );
}
