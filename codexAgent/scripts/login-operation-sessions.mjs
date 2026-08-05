function sessionError(message) {
    const error = new Error(message);
    error.code = 'PLOINKY_PROVIDER_LOGIN_INVOCATION_INVALID';
    return error;
}

/**
 * Keep Codex provider code independent from the AgentServer registry's transport
 * surface. Every control forwards the exact flow/continuation-handle binding;
 * no flow-id-only API is exposed to the provider implementation.
 */
export function createCodexLoginOperationSessions(operationSessions) {
    if (!operationSessions || typeof operationSessions !== 'object'
        || typeof operationSessions.retainLoginOperation !== 'function'
        || typeof operationSessions.getLoginStatus !== 'function'
        || typeof operationSessions.respondToLogin !== 'function'
        || typeof operationSessions.cancelLogin !== 'function') {
        throw sessionError('Codex login requires the AgentServer operation session capability.');
    }
    return Object.freeze({
        retainDeviceLogin(input = {}) {
            return operationSessions.retainLoginOperation(input);
        },
        getStatus(input = {}) {
            return operationSessions.getLoginStatus({
                flowId: input.flowId,
                continuationHandle: input.continuationHandle,
            });
        },
        respond(input = {}) {
            return operationSessions.respondToLogin({
                flowId: input.flowId,
                continuationHandle: input.continuationHandle,
            }, {
                seq: input.seq,
                nonce: input.nonce,
                response: input.response,
            });
        },
        cancel(input = {}) {
            return operationSessions.cancelLogin({
                flowId: input.flowId,
                continuationHandle: input.continuationHandle,
            });
        },
    });
}
