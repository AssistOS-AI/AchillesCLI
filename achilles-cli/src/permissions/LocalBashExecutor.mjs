import { executeProcess } from '../broker/sandbox.mjs';

export function createBashExecutor({
    cwd = process.cwd(),
    env = process.env,
    execute = executeProcess,
} = {}) {
    return async (params) => {
        const normalized = normalizeExecutorParams(params);
        if (!normalized.command) {
            return {
                success: false,
                output: '',
                stderr: '',
                error: 'No executable Bash command was provided.',
                exitCode: null,
                signal: null,
                timedOut: false,
            };
        }
        const result = await execute({
            command: normalized.command,
            args: normalized.args,
            cwd,
            env,
        });
        return normalizeExecutionResult(result);
    };
}

function normalizeExecutorParams(params = {}) {
    return {
        command: String(params.command || '').trim(),
        args: Array.isArray(params.args) ? params.args.map(String) : [],
    };
}

function normalizeExecutionResult(result = {}) {
    return {
        success: Boolean(result.success),
        output: String(result.stdout || '').trim(),
        stderr: String(result.stderr || '').trim(),
        error: result.error || null,
        exitCode: result.status ?? null,
        signal: result.signal || null,
        timedOut: Boolean(result.timedOut),
    };
}
