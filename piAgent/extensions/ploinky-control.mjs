const MODEL_RUNTIME_MODULE = '/home/agent/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
const CONTINUATION_STORE_MODULE = '/code/scripts/continuation-store.mjs';
const RESPONSE_MARKER = 'PLOINKY_PI_CONTROL_RESPONSE ';
const RETAINED_REQUIRED_CODE = 'PLOINKY_PROVIDER_LOGIN_RETAINED_REQUIRED';
const OAUTH_KINDS = new Map([
    ['anthropic', 'manual_oauth_code'],
    ['github-copilot', 'device_code'],
    ['kimi-coding', 'device_code'],
    ['openai-codex', 'device_code'],
    ['openrouter', 'manual_oauth_code'],
    ['radius', 'device_code'],
    ['xai', 'device_code'],
]);

function assertInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new TypeError('PI control input must be an object');
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('PI control input must be a plain object');
    }
    const operation = typeof input.operation === 'string' ? input.operation : '';
    const allowed = {
        login_describe: new Set(['operation', 'handle']),
        login_start: new Set(['operation', 'handle', 'provider', 'method', 'apiKey']),
    }[operation];
    if (!allowed) throw new TypeError('PI control operation is invalid');
    for (const name of Reflect.ownKeys(input)) {
        if (typeof name !== 'string' || !allowed.has(name)) {
            throw new TypeError(`PI control input contains unknown field ${String(name)}`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(input, name);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
            throw new TypeError(`PI control input field ${name} must be a data property`);
        }
    }
    if (!Object.hasOwn(input, 'operation') || !Object.hasOwn(input, 'handle')
        || (operation === 'login_start'
            && (!Object.hasOwn(input, 'provider') || !Object.hasOwn(input, 'method')))) {
        throw new TypeError('PI control input is incomplete');
    }
    return input;
}

function providerDescriptors(runtime) {
    return runtime.getProviders().map((provider) => {
        const methods = [];
        if (provider?.auth?.apiKey?.login) {
            methods.push({
                key: 'api_key',
                kind: 'api_key',
                label: String(provider.auth.apiKey.name || 'API key'),
            });
        }
        const oauthKind = OAUTH_KINDS.get(String(provider?.id || ''));
        if (provider?.auth?.oauth?.login && oauthKind) {
            methods.push({
                key: 'oauth',
                kind: oauthKind,
                label: String(
                    provider.auth.oauth.loginLabel
                    || provider.auth.oauth.name
                    || 'Browser authentication',
                ),
            });
        }
        return {
            key: String(provider?.id || ''),
            label: String(provider?.name || provider?.id || ''),
            methods,
        };
    }).filter((provider) => provider.key && provider.methods.length);
}

function unsupported(operation) {
    return {
        ok: false,
        code: RETAINED_REQUIRED_CODE,
        error: `PI ${operation} requires the AgentServer-owned retained provider operation lifecycle.`,
    };
}

function redactInputSecrets(message, input) {
    const values = [
        input?.apiKey,
    ].filter((value) => typeof value === 'string' && value.length > 0);
    let redacted = String(message || 'PI control failed.');
    for (const value of values) redacted = redacted.split(value).join('[REDACTED]');
    return redacted.slice(0, 500);
}

async function createModelRuntime() {
    const module = await import(MODEL_RUNTIME_MODULE);
    if (typeof module?.ModelRuntime?.create !== 'function') {
        throw new Error('PI ModelRuntime is unavailable');
    }
    return module.ModelRuntime.create({ allowModelNetwork: false });
}

async function readContinuationRecord(handle) {
    const module = await import(CONTINUATION_STORE_MODULE);
    if (typeof module?.readContinuationRecord !== 'function') {
        throw new Error('PI continuation store is unavailable');
    }
    return module.readContinuationRecord(handle);
}

const productionDependencies = Object.freeze({ createModelRuntime, readContinuationRecord });

export async function executeControlCommand(rawInput, dependencies = productionDependencies) {
    const input = assertInput(rawInput);
    if (!dependencies || typeof dependencies !== 'object'
        || typeof dependencies.createModelRuntime !== 'function'
        || typeof dependencies.readContinuationRecord !== 'function') {
        throw new TypeError('PI control dependencies are invalid');
    }
    await dependencies.readContinuationRecord(String(input.handle || '').trim());
    const operation = String(input.operation || '');
    const runtime = await dependencies.createModelRuntime();
    const providers = providerDescriptors(runtime);
    if (operation === 'login_describe') {
        return {
            ok: true,
            response: { type: 'login-catalog', version: 1, providers },
        };
    }
    if (operation !== 'login_start') throw new Error('unsupported_login_operation');
    const provider = providers.find((entry) => entry.key === String(input.provider || ''));
    const method = provider?.methods.find((entry) => entry.key === String(input.method || ''));
    if (!provider || !method) throw new Error('unsupported_login_method');
    if (method.key !== 'api_key') return unsupported(method.kind);
    const apiKey = String(input.apiKey || '');
    if (!apiKey || apiKey.includes('\0') || Buffer.byteLength(apiKey, 'utf8') > 65536) {
        throw new Error('api_key_required');
    }
    let promptCount = 0;
    try {
        await runtime.login(provider.key, 'api_key', {
            notify() {
                throw new Error('PI API-key login unexpectedly requested a multi-turn notification');
            },
            async prompt(prompt) {
                promptCount += 1;
                if (promptCount !== 1 || !['secret', 'text'].includes(String(prompt?.type || ''))) {
                    throw new Error('PI API-key login requires an unsupported multi-turn prompt');
                }
                return apiKey;
            },
        });
    } catch (error) {
        return {
            ok: false,
            code: String(error?.code || 'PLOINKY_PI_LOGIN_FAILED'),
            error: redactInputSecrets(error?.message, input),
        };
    }
    return {
        ok: true,
        response: {
            type: 'login-flow',
            version: 1,
            status: 'completed',
            provider: provider.key,
            method: method.key,
        },
    };
}

function decodeCommandInput(args) {
    const encoded = String(args || '').trim();
    if (!/^[A-Za-z0-9_-]{1,131072}$/.test(encoded)) {
        throw new Error('invalid_control_command');
    }
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
}

function emitResponse(value) {
    const encoded = Buffer.from(JSON.stringify(value)).toString('base64url');
    process.stdout.write(`${RESPONSE_MARKER}${encoded}\n`);
}

export default function registerPloinkyControl(pi) {
    pi.registerCommand('ploinky-control', {
        description: 'Run one trusted Ploinky PI control operation.',
        async handler(args) {
            try {
                emitResponse(await executeControlCommand(decodeCommandInput(args)));
            } catch (error) {
                emitResponse({
                    ok: false,
                    code: String(error?.code || 'PLOINKY_PI_CONTROL_FAILED'),
                    error: String(error?.message || 'PI control failed.').slice(0, 500),
                });
            }
        },
    });
}

export const __testables = Object.freeze({
    CONTINUATION_STORE_MODULE,
    MODEL_RUNTIME_MODULE,
    OAUTH_KINDS,
    RESPONSE_MARKER,
    RETAINED_REQUIRED_CODE,
    providerDescriptors,
    redactInputSecrets,
});
