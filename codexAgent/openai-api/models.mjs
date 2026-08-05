const CODEX_EXECUTABLE = '/home/agent/.local/bin/codex';
const REQUEST_TIMEOUT_MS = 30000;

function providerError(code, message, options) {
    const error = new Error(message, options);
    error.code = code;
    return error;
}

function requestError(payload) {
    return providerError(
        'PLOINKY_CODEX_APP_SERVER_FAILED',
        payload?.error?.message || 'Codex app-server request failed.',
    );
}

function assertOperationRuntime(providerRuntime) {
    if (!providerRuntime || typeof providerRuntime !== 'object'
        || providerRuntime.mode !== undefined && providerRuntime.mode !== 'operation'
        || typeof providerRuntime.launch !== 'function') {
        throw providerError(
            'PLOINKY_PROVIDER_RUNTIME_REQUIRED',
            'Codex model listing requires an injected operation providerRuntime capability',
        );
    }
    return providerRuntime;
}

function assertOperationHandle(handle) {
    if (!handle || typeof handle !== 'object'
        || !handle.child?.stdin || !handle.child?.stdout || !handle.child?.stderr
        || !(handle.completion instanceof Promise)
        || handle.launch?.helper !== '/usr/local/libexec/ploinky-bwrap-launch'
        || handle.launch?.provider !== 'codex'
        || handle.launch?.mode !== 'operation'
        || handle.launch?.workdir !== null
        || handle.launch?.cwd !== '/workspace/operation') {
        throw providerError(
            'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID',
            'Codex model listing did not receive the canonical private operation boundary',
        );
    }
    return handle;
}

export function codexModelDescriptor(raw) {
    const id = String(raw?.id || raw?.model || raw?.slug || '').trim();
    if (!id) return null;
    const contextWindow = Number(raw?.contextWindow ?? raw?.context_window);
    return {
        id,
        object: 'model',
        modelId: id,
        providerModelId: id,
        displayName: String(raw?.displayName || raw?.display_name || raw?.name || id),
        contextWindow: Number.isFinite(contextWindow) ? contextWindow : null,
        maxOutputTokens: null,
        supportsTools: true,
        supportsStreaming: false,
        supportsVision: raw?.supportsImages === true || raw?.supports_images === true,
        tags: ['coding-agent'],
        metadata: {
            codexModel: id,
            description: String(raw?.description || ''),
            defaultReasoningEffort: raw?.defaultReasoningEffort || raw?.default_reasoning_effort || null,
            reasoningEfforts: raw?.supportedReasoningEfforts || raw?.supported_reasoning_efforts || [],
        },
        execution: { model: id },
    };
}

export async function listCodexModels({
    providerRuntime,
    timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > REQUEST_TIMEOUT_MS) {
        throw providerError(
            'PLOINKY_PROVIDER_RUNTIME_INPUT_INVALID',
            'Codex model listing timeout is invalid',
        );
    }
    const runtime = assertOperationHandle(await assertOperationRuntime(providerRuntime).launch(
        { command: [CODEX_EXECUTABLE, 'app-server', '--stdio'] },
        { stdio: ['pipe', 'pipe', 'pipe'] },
    ));
    const { child } = runtime;
    return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) reject(error);
            else resolve(value);
        };
        const timer = setTimeout(() => {
            finish(providerError(
                'PLOINKY_CODEX_APP_SERVER_TIMEOUT',
                `Codex model listing timed out.${stderr.trim() ? ` ${stderr.trim()}` : ''}`,
            ));
        }, timeoutMs);
        const send = (payload) => child.stdin.write(`${JSON.stringify(payload)}\n`);
        const consumeLine = (line) => {
            let payload;
            try { payload = JSON.parse(line); } catch { return; }
            if (payload.id === 1) {
                if (payload.error) return finish(requestError(payload));
                send({ method: 'initialized' });
                send({ id: 2, method: 'model/list', params: { limit: 100 } });
                return;
            }
            if (payload.id === 2) {
                if (payload.error) return finish(requestError(payload));
                const records = Array.isArray(payload?.result?.data)
                    ? payload.result.data
                    : (Array.isArray(payload?.result?.models) ? payload.result.models : []);
                finish(null, records.map(codexModelDescriptor).filter(Boolean));
            }
        };
        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString('utf8');
            let newline = stdout.indexOf('\n');
            while (newline >= 0) {
                consumeLine(stdout.slice(0, newline));
                stdout = stdout.slice(newline + 1);
                newline = stdout.indexOf('\n');
            }
        });
        child.stderr.on('data', (chunk) => {
            stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8192);
        });
        child.on('error', (error) => finish(providerError(
            'PLOINKY_CODEX_APP_SERVER_FAILED',
            'Codex app-server failed to start.',
            { cause: error },
        )));
        runtime.completion.then(({ code, signal }) => {
            finish(providerError(
                'PLOINKY_CODEX_APP_SERVER_FAILED',
                stderr.trim() || `Codex app-server exited (${signal || code || 'unknown'}).`,
            ));
        }, (error) => finish(error));
        send({
            id: 1,
            method: 'initialize',
            params: {
                clientInfo: { name: 'ploinky-models', title: 'Ploinky Models', version: '1.0.0' },
            },
        });
    });
}

export async function executeCodexModels(_payload, { providerRuntime, signal } = {}) {
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
        throw providerError(
            'PLOINKY_PROVIDER_RUNTIME_INPUT_INVALID',
            'Codex model listing signal must be an AbortSignal',
        );
    }
    return {
        ok: true,
        response: {
            object: 'list',
            data: await listCodexModels({ providerRuntime }),
        },
    };
}

export const __testables = Object.freeze({
    CODEX_EXECUTABLE,
    REQUEST_TIMEOUT_MS,
    assertOperationHandle,
});
