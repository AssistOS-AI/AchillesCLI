const PROVIDER_SANDBOX_MODULE = '/Agent/lib/providerSandbox.mjs';
const PROVIDER = 'codex';
const PROVIDER_EXECUTABLE = '/home/agent/.local/bin/codex';

let providerSandboxPromise;

function assertPlainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be a plain object`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${label} must be a plain object`);
    }
}

function assertInput(input) {
    assertPlainObject(input, 'Codex task sandbox input');
    const allowed = new Set(['args', 'credentialContext', 'environment', 'workdir']);
    for (const name of Reflect.ownKeys(input)) {
        if (typeof name !== 'string' || !allowed.has(name)) {
            throw new TypeError(`Codex task sandbox input contains unsupported field ${String(name)}`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(input, name);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError(`Codex task sandbox input field ${name} must be a data property`);
        }
    }
    if (input.credentialContext === null || input.credentialContext === undefined) {
        throw new TypeError('Codex task sandbox input requires credentialContext');
    }
    if (typeof input.workdir !== 'string' || !input.workdir) {
        throw new TypeError('Codex task sandbox input requires workdir');
    }
    if (!Array.isArray(input.args) || input.args.some((argument) => typeof argument !== 'string')) {
        throw new TypeError('Codex task sandbox input requires string args');
    }
    if (input.environment !== undefined) {
        assertPlainObject(input.environment, 'Codex task sandbox environment');
    }
    return input;
}

function assertProviderSandbox(module) {
    if (!module || typeof module !== 'object') {
        throw new TypeError('the canonical provider sandbox module is required');
    }
    for (const name of [
        'buildProviderSandboxPolicy',
        'buildProviderSandboxLaunch',
        'spawnProviderSandbox',
    ]) {
        if (typeof module[name] !== 'function') {
            throw new TypeError(`the canonical provider sandbox module is missing ${name}`);
        }
    }
    if (module.PROVIDER_SANDBOX_MODES?.TASK !== 'task') {
        throw new TypeError('the canonical provider sandbox task mode is unavailable');
    }
    return module;
}

async function loadProviderSandbox(dependencies = {}) {
    assertPlainObject(dependencies, 'Codex provider sandbox dependencies');
    for (const name of Reflect.ownKeys(dependencies)) {
        if (name !== 'providerSandbox') {
            throw new TypeError(`unsupported Codex provider sandbox dependency ${String(name)}`);
        }
    }
    if (Object.hasOwn(dependencies, 'providerSandbox')) {
        const descriptor = Object.getOwnPropertyDescriptor(dependencies, 'providerSandbox');
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError('providerSandbox dependency must be a data property');
        }
        return assertProviderSandbox(descriptor.value);
    }
    providerSandboxPromise ||= import(PROVIDER_SANDBOX_MODULE);
    return assertProviderSandbox(await providerSandboxPromise);
}

function taskInput(input, providerSandbox) {
    const checked = assertInput(input);
    return {
        credentialContext: checked.credentialContext,
        environment: checked.environment ?? {},
        mode: providerSandbox.PROVIDER_SANDBOX_MODES.TASK,
        provider: PROVIDER,
        command: [PROVIDER_EXECUTABLE, ...checked.args],
        workdir: checked.workdir,
    };
}

export async function buildTaskSandboxPolicy(input, dependencies = {}) {
    const providerSandbox = await loadProviderSandbox(dependencies);
    return providerSandbox.buildProviderSandboxPolicy(taskInput(input, providerSandbox));
}

export async function buildTaskSandboxLaunch(input, dependencies = {}) {
    const providerSandbox = await loadProviderSandbox(dependencies);
    return providerSandbox.buildProviderSandboxLaunch(taskInput(input, providerSandbox));
}

export async function spawnTaskSandbox(input, lifecycle = {}, dependencies = {}) {
    assertPlainObject(lifecycle, 'Codex task sandbox lifecycle');
    const providerSandbox = await loadProviderSandbox(dependencies);
    return providerSandbox.spawnProviderSandbox(
        taskInput(input, providerSandbox),
        lifecycle,
    );
}

export const __testables = Object.freeze({
    PROVIDER,
    PROVIDER_EXECUTABLE,
    PROVIDER_SANDBOX_MODULE,
});
