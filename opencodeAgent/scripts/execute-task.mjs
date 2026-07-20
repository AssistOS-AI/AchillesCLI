#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeOpenCodeTask } from './opencode-runner.mjs';
import {
    continuationDescriptor,
    createContinuationHandle,
    writeContinuationRecord,
} from './continuation-store.mjs';

async function readStdin() {
    if (process.stdin.isTTY) {
        return '';
    }
    process.stdin.setEncoding('utf8');
    let data = '';
    for await (const chunk of process.stdin) {
        data += chunk;
    }
    return data;
}

function parseInput(raw) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) {
        return null;
    }
    try {
        const parsed = JSON.parse(trimmed);
        return parsed.input && typeof parsed.input === 'object' ? parsed.input : parsed;
    } catch {
        return null;
    }
}

async function main() {
    const stdinData = await readStdin();
    const input = parseInput(stdinData);

    if (!input) {
        process.stderr.write('Invalid or missing input. Expected JSON with prompt and projectDir.\n');
        process.exitCode = 1;
        return;
    }

    const { prompt, projectDir, model } = input;

    if (typeof prompt !== 'string' || !prompt.trim()) {
        process.stderr.write('prompt is required and must be a non-empty string.\n');
        process.exitCode = 1;
        return;
    }

    if (!projectDir || typeof projectDir !== 'string' || !projectDir.trim()) {
        process.stderr.write('projectDir is required and must be a non-empty string.\n');
        process.exitCode = 1;
        return;
    }

    const result = await executeOpenCodeTask({
        prompt,
        projectDir: projectDir.trim(),
        model,
        captureSession: true,
        createProjectDir: true,
    });

    if (!result.sessionId) {
        process.stderr.write(`${result.error || 'OpenCode did not report a resumable session id.'}\n`);
        process.exitCode = 1;
        return;
    }
    const handle = createContinuationHandle();
    writeContinuationRecord(handle, {
        sessionId: result.sessionId,
        projectDir: projectDir.trim(),
    });
    const payload = {
        outputText: result.outputText || '',
        continuation: continuationDescriptor(handle),
    };
    process.stdout.write(JSON.stringify(payload));
    if (!result.ok) {
        process.stderr.write(`${result.error || 'OpenCode task failed.'}\n`);
        process.exitCode = 1;
    }
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
