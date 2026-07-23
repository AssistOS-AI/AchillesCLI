import {
    clearSelectedModel,
    getSelectedModel,
    setSelectedModel,
} from './achillesSettings.mjs';

const WEBCHAT_RUNTIME_STATE_VERSION = 1;

export function createWebchatRuntimeStateEnvelope(model) {
    const selectedModel = typeof model === 'string' && model.trim()
        ? model.trim()
        : null;
    return {
        __webchatRuntimeState: 1,
        version: WEBCHAT_RUNTIME_STATE_VERSION,
        model: selectedModel,
    };
}

export function emitWebchatRuntimeState(model, {
    write,
} = {}) {
    const output = typeof write === 'function'
        ? write
        : (value) => process.stdout.write(value);
    const envelope = createWebchatRuntimeStateEnvelope(model);
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
