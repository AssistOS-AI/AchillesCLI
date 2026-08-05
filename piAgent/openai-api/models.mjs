const PI_EXECUTABLE = '/home/agent/.local/bin/pi';
const SOUL_EXTENSION_PATH = '/code/extensions/ploinky-soul.mjs';
const SOUL_PROVIDER = 'ploinky-soul';
const SOUL_MODELS = new Set(['fast', 'plan', 'deep']);
const OUTPUT_LIMIT = 256 * 1024;
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

function providerError(code, message, options) {
    const error = new Error(message, options);
    error.code = code;
    return error;
}

function stripAnsi(value) {
    return String(value || '').replace(ANSI_PATTERN, '');
}

function parseCompactNumber(value) {
    const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)([KM])?$/i);
    if (!match) return null;
    const multiplier = match[2]?.toUpperCase() === 'M'
        ? 1000000
        : (match[2]?.toUpperCase() === 'K' ? 1000 : 1);
    return Math.round(Number(match[1]) * multiplier);
}

function piModelDescriptor({ provider, model, context, maxOutput, thinking, images }) {
    return {
        id: model,
        object: 'model',
        modelId: model,
        providerModelId: `${provider}/${model}`,
        displayName: `Soul ${model}`,
        contextWindow: parseCompactNumber(context),
        maxOutputTokens: parseCompactNumber(maxOutput),
        supportsTools: true,
        supportsStreaming: false,
        supportsVision: images.toLowerCase() === 'yes',
        tags: ['coding-agent'],
        metadata: {
            piProvider: provider,
            piModelId: model,
            supportsThinking: thinking.toLowerCase() === 'yes',
        },
        execution: { model },
    };
}

export function parsePiModelsTable(output) {
    const lines = stripAnsi(output).split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2 || !/^provider\s+model\s+context\s+max-out\s+thinking\s+images$/i.test(lines[0].trim())) {
        return [];
    }
    const models = [];
    for (const line of lines.slice(1)) {
        const columns = line.trim().split(/\s{2,}/);
        if (columns.length !== 6) continue;
        const [provider, model, context, maxOutput, thinking, images] = columns;
        if (provider !== SOUL_PROVIDER || !SOUL_MODELS.has(model)) continue;
        models.push(piModelDescriptor({
            provider,
            model,
            context,
            maxOutput,
            thinking,
            images,
        }));
    }
    const ids = new Set(models.map(({ id }) => id));
    if (models.length !== SOUL_MODELS.size || ids.size !== SOUL_MODELS.size
        || [...SOUL_MODELS].some((id) => !ids.has(id))) {
        return [];
    }
    return models;
}

function assertOperationRuntime(providerRuntime) {
    if (!providerRuntime || typeof providerRuntime !== 'object'
        || providerRuntime.mode !== 'operation'
        || providerRuntime.provider !== 'pi'
        || typeof providerRuntime.launch !== 'function') {
        throw providerError(
            'PLOINKY_PROVIDER_RUNTIME_REQUIRED',
            'PI model listing requires the injected PI operation provider runtime',
        );
    }
    return providerRuntime;
}

function assertOperationHandle(handle) {
    if (!handle || typeof handle !== 'object'
        || !handle.child?.stdout || !handle.child?.stderr
        || !(handle.completion instanceof Promise)
        || handle.launch?.helper !== '/usr/local/libexec/ploinky-bwrap-launch'
        || handle.launch?.provider !== 'pi'
        || handle.launch?.mode !== 'operation'
        || handle.launch?.workdir !== null
        || handle.launch?.cwd !== '/workspace/operation') {
        throw providerError(
            'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID',
            'PI model listing did not receive the canonical private operation boundary',
        );
    }
    return handle;
}

function collectBounded(stream, label) {
    let output = '';
    let bytes = 0;
    stream.on('data', (chunk) => {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes <= OUTPUT_LIMIT) output += buffer.toString('utf8');
    });
    return {
        value() {
            if (bytes > OUTPUT_LIMIT) {
                throw providerError(
                    'PLOINKY_PI_MODELS_INVALID',
                    `PI model ${label} exceeded the bounded output limit`,
                );
            }
            return output;
        },
    };
}

export async function listPiModels({ providerRuntime } = {}) {
    const runtime = assertOperationHandle(await assertOperationRuntime(providerRuntime).launch({
        command: [
            PI_EXECUTABLE,
            '--extension',
            SOUL_EXTENSION_PATH,
            '--list-models',
            SOUL_PROVIDER,
        ],
    }, {
        stdio: ['ignore', 'pipe', 'pipe'],
    }));
    const stdout = collectBounded(runtime.child.stdout, 'stdout');
    const stderr = collectBounded(runtime.child.stderr, 'stderr');
    const result = await runtime.completion;
    const stdoutText = stdout.value();
    const stderrText = stderr.value();
    if (result?.code !== 0 || result?.signal) {
        throw providerError(
            'PLOINKY_PI_MODELS_FAILED',
            stderrText.trim()
                || `PI model listing failed (${result?.signal || result?.code || 'unknown'}).`,
        );
    }
    const models = parsePiModelsTable(stdoutText);
    if (models.length !== SOUL_MODELS.size) {
        throw providerError(
            'PLOINKY_PI_MODELS_INVALID',
            'PI model listing did not return the exact scoped Soul model set',
        );
    }
    return models;
}

export async function executePiModels(_payload, { providerRuntime, signal } = {}) {
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
        throw providerError(
            'PLOINKY_PROVIDER_RUNTIME_INPUT_INVALID',
            'PI model listing signal must be an AbortSignal',
        );
    }
    return {
        ok: true,
        response: {
            object: 'list',
            data: await listPiModels({ providerRuntime }),
        },
    };
}

export const __testables = Object.freeze({
    OUTPUT_LIMIT,
    PI_EXECUTABLE,
    SOUL_EXTENSION_PATH,
    SOUL_PROVIDER,
    assertOperationHandle,
});
