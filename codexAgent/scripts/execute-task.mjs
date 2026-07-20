#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { executeCodexTask } from './codex-runner.mjs';
import {
    continuationDescriptor,
    createContinuationHandle,
    writeContinuationRecord,
} from './continuation-store.mjs';

async function readStdin() {
    if (process.stdin.isTTY) return '';
    process.stdin.setEncoding('utf8');
    let data = '';
    for await (const chunk of process.stdin) data += chunk;
    return data;
}

function parseInput(raw) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) return null;
    try {
        const parsed = JSON.parse(trimmed);
        return parsed.input && typeof parsed.input === 'object' ? parsed.input : parsed;
    } catch {
        return null;
    }
}

async function main() {
    const input = parseInput(await readStdin());
    if (!input) {
        process.stderr.write('Invalid or missing input. Expected JSON with prompt and projectDir.\n');
        process.exitCode = 1;
        return;
    }
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
    const projectDir = typeof input.projectDir === 'string' ? input.projectDir.trim() : '';
    if (!prompt) {
        process.stderr.write('prompt is required and must be a non-empty string.\n');
        process.exitCode = 1;
        return;
    }
    if (!projectDir) {
        process.stderr.write('projectDir is required and must be a non-empty string.\n');
        process.exitCode = 1;
        return;
    }

    const result = await executeCodexTask({
        prompt,
        projectDir,
        model: input.model,
    });
    if (!result.threadId) {
        process.stderr.write(`${result.error || 'Codex did not report a resumable thread id.'}\n`);
        process.exitCode = 1;
        return;
    }
    const handle = createContinuationHandle();
    writeContinuationRecord(handle, {
        threadId: result.threadId,
        projectDir,
    });
    process.stdout.write(JSON.stringify({
        outputText: result.outputText || '',
        continuation: continuationDescriptor(handle),
    }));
    if (!result.ok) {
        process.stderr.write(`${result.error || 'Codex task failed.'}\n`);
        process.exitCode = 1;
    }
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
    main().catch((error) => {
        process.stderr.write(`${error?.message || error}\n`);
        process.exitCode = 1;
    });
}
