#!/usr/bin/env node

import {
    continuationDescriptor,
    readContinuationRecord,
    writeContinuationRecord,
} from './continuation-store.mjs';
import {
    executeTask,
    readCurrentPiModel,
} from './execute-task.mjs';

async function readStdin() {
    process.stdin.setEncoding('utf8');
    let data = '';
    for await (const chunk of process.stdin) data += chunk;
    return data;
}

function parseInput(raw) {
    try {
        const parsed = JSON.parse(String(raw || '').trim());
        return parsed?.input && typeof parsed.input === 'object' ? parsed.input : parsed;
    } catch {
        return null;
    }
}

async function main() {
    const cancellation = new AbortController();
    process.on('SIGTERM', () => cancellation.abort());
    const input = parseInput(await readStdin());
    const handle = String(input?.handle || '').trim();
    const prompt = String(input?.prompt || '').trim();
    const requestedProvider = String(input?.provider || '').trim();
    const requestedModel = String(input?.model || '').trim();
    if (!handle || !prompt) throw new Error('handle and prompt are required');
    const record = readContinuationRecord(handle);
    const currentModel = requestedModel
        ? { provider: requestedProvider, model: requestedModel, thinking: '' }
        : readCurrentPiModel({ projectDir: record.projectDir });
    const result = await executeTask({
        prompt,
        projectDir: record.projectDir,
        provider: currentModel.provider,
        model: currentModel.model,
        thinking: currentModel.thinking,
        sessionId: record.sessionId,
        sessionDir: record.sessionDir,
        signal: cancellation.signal,
    });
    if (!result?.ok) {
        process.stdout.write(JSON.stringify({
            outputText: result?.outputText || '',
            continuation: continuationDescriptor(handle),
        }));
        process.stderr.write(`${result?.error || 'PI continuation failed.'}\n`);
        process.exitCode = 1;
        return;
    }
    writeContinuationRecord(handle, record);
    process.stdout.write(JSON.stringify({
        outputText: result.outputText || '',
        continuation: continuationDescriptor(handle),
    }));
}

main().catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
});
