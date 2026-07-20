#!/usr/bin/env node

import {
    continuationDescriptor,
    readContinuationRecord,
    writeContinuationRecord,
} from './continuation-store.mjs';
import { executeCodexTask } from './codex-runner.mjs';

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
    if (!handle || !prompt) throw new Error('handle and prompt are required');
    const record = readContinuationRecord(handle);
    const result = await executeCodexTask({
        prompt,
        projectDir: record.projectDir,
        threadId: record.threadId,
        signal: cancellation.signal,
    });
    if (!result.ok) {
        process.stdout.write(JSON.stringify({
            outputText: result.outputText || '',
            continuation: continuationDescriptor(handle),
        }));
        process.stderr.write(`${result.error || 'Codex continuation failed.'}\n`);
        process.exitCode = 1;
        return;
    }
    writeContinuationRecord(handle, {
        ...record,
        threadId: result.threadId || record.threadId,
    });
    process.stdout.write(JSON.stringify({
        outputText: result.outputText || '',
        continuation: continuationDescriptor(handle),
    }));
}

main().catch((error) => {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
});
