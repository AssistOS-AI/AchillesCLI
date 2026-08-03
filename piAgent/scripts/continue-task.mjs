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
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function safeErrorText(result, fallback) {
    const message = result?.error || fallback;
    return result?.code && !String(message).includes(result.code)
        ? `${result.code}: ${message}`
        : message;
}

export async function main({ sandboxDependencies } = {}) {
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
        sandboxDependencies,
    });
    if (!result?.ok) {
        process.stdout.write(JSON.stringify({
            ok: false,
            outputText: result?.outputText || '',
            continuation: continuationDescriptor(handle),
            error: result?.error,
            code: result?.code,
            status: result?.status,
            cause: result?.cause,
        }));
        process.stderr.write(`${safeErrorText(result, 'PI continuation failed.')}\n`);
        process.exitCode = 1;
        return;
    }
    writeContinuationRecord(handle, record);
    process.stdout.write(JSON.stringify({
        outputText: result.outputText || '',
        continuation: continuationDescriptor(handle),
    }));
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
    main().catch((error) => {
        process.stderr.write(`${error?.message || error}\n`);
        process.exitCode = 1;
    });
}
