const PROVIDER_SANDBOX_MODULE = '/Agent/lib/providerSandbox.mjs';
const PROVIDER = 'pi';
const PROVIDER_EXECUTABLE = '/home/agent/.local/bin/pi';

let providerSandboxPromise;

function assertInput(input, label) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError(`${label} requires an input object`);
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${label} requires a plain input object`);
    }
    if (Object.hasOwn(input, 'mode') || Object.hasOwn(input, 'provider')) {
        throw new TypeError(`${label} owns its fixed provider and mode`);
    }
    const allowed = new Set(['args', 'credentialContext', 'environment', 'workdir']);
    for (const name of Reflect.ownKeys(input)) {
        if (typeof name !== 'string' || !allowed.has(name)) {
            throw new TypeError(`${label} contains unsupported field ${String(name)}`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(input, name);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError(`${label} field ${name} must be a data property`);
        }
    }
    if (!Object.hasOwn(input, 'credentialContext')
        || input.credentialContext === null
        || input.credentialContext === undefined) {
        throw new TypeError(`${label} requires credentialContext`);
    }
    if (!Array.isArray(input.args) || input.args.some((argument) => typeof argument !== 'string')) {
        throw new TypeError(`${label} requires string args`);
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
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
        throw new TypeError('provider sandbox dependencies must be an object');
    }
    const prototype = Object.getPrototypeOf(dependencies);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('provider sandbox dependencies must be a plain object');
    }
    for (const name of Reflect.ownKeys(dependencies)) {
        if (name !== 'providerSandbox') {
            throw new TypeError(`unsupported provider sandbox dependency ${String(name)}`);
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

function taskInput(input, providerSandbox) {
    const { args, ...trustedInput } = assertInput(input, 'PI task sandbox');
    return {
        ...trustedInput,
        mode: providerSandbox.PROVIDER_SANDBOX_MODES.TASK,
        provider: PROVIDER,
        command: [PROVIDER_EXECUTABLE, ...args],
    };
}

export async function buildTaskSandboxPolicy(input, dependencies = {}) {
    const checkedInput = assertInput(input, 'PI task sandbox');
    const providerSandbox = await loadProviderSandbox(dependencies);
    return providerSandbox.buildProviderSandboxPolicy(taskInput(checkedInput, providerSandbox));
}

export async function buildTaskSandboxLaunch(input, dependencies = {}) {
    const checkedInput = assertInput(input, 'PI task sandbox');
    const providerSandbox = await loadProviderSandbox(dependencies);
    return providerSandbox.buildProviderSandboxLaunch(taskInput(checkedInput, providerSandbox));
}

export async function spawnTaskSandbox(input, lifecycle = {}, dependencies = {}) {
    const checkedInput = assertInput(input, 'PI task sandbox');
    const providerSandbox = await loadProviderSandbox(dependencies);
    return providerSandbox.spawnProviderSandbox(
        taskInput(checkedInput, providerSandbox),
        lifecycle,
    );
}

export const __testables = Object.freeze({
    PROVIDER,
    PROVIDER_EXECUTABLE,
    PROVIDER_SANDBOX_MODULE,
});
