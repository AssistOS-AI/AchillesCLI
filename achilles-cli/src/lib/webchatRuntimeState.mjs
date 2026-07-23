import { randomUUID } from 'node:crypto';

import {
    clearSelectedModel,
    getSelectedModel,
    setSelectedModel,
} from './achillesSettings.mjs';

const WEBCHAT_RUNTIME_STATE_VERSION = 1;
const WEBCHAT_RUNTIME_INSTANCE_ID = randomUUID();

export function createWebchatRuntimeStateEnvelope(model, {
    runtimeInstanceId = WEBCHAT_RUNTIME_INSTANCE_ID,
} = {}) {
    const selectedModel = typeof model === 'string' && model.trim()
        ? model.trim()
        : null;
    return {
        __webchatRuntimeState: 1,
        version: WEBCHAT_RUNTIME_STATE_VERSION,
        model: selectedModel,
        runtimeInstanceId,
    };
}

export function emitWebchatRuntimeState(model, {
    write,
    runtimeInstanceId = WEBCHAT_RUNTIME_INSTANCE_ID,
} = {}) {
    const output = typeof write === 'function'
        ? write
        : (value) => process.stdout.write(value);
    const envelope = createWebchatRuntimeStateEnvelope(model, { runtimeInstanceId });
    output(`${JSON.stringify(envelope)}\n`);
    return envelope;
}

export function selectWebchatRuntimeModel({
    workingDir,
    model,
    slashState,
    emitRuntimeState = emitWebchatRuntimeState,
}) {
    setSelectedModel(workingDir, model);
    slashState.pinnedModel = getSelectedModel(workingDir);
    emitRuntimeState(slashState.pinnedModel);
    return slashState.pinnedModel;
}

export function clearWebchatRuntimeModel({
    workingDir,
    slashState,
    emitRuntimeState = emitWebchatRuntimeState,
}) {
    clearSelectedModel(workingDir);
    slashState.pinnedModel = getSelectedModel(workingDir);
    emitRuntimeState(slashState.pinnedModel);
    return slashState.pinnedModel;
}
