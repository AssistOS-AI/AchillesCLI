#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeOpenCodeTask } from './opencode-runner.mjs';

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
        process.stdout.write(JSON.stringify({
            ok: false,
            error: 'Invalid or missing input. Expected JSON with prompt and projectDir.',
        }));
        process.exitCode = 1;
        return;
    }

    const { prompt, projectDir, model } = input;

    if (typeof prompt !== 'string' || !prompt.trim()) {
        process.stdout.write(JSON.stringify({ ok: false, error: 'prompt is required and must be a non-empty string.' }));
        process.exitCode = 1;
        return;
    }

    if (!projectDir || typeof projectDir !== 'string' || !projectDir.trim()) {
        process.stdout.write(JSON.stringify({ ok: false, error: 'projectDir is required and must be a non-empty string.' }));
        process.exitCode = 1;
        return;
    }

    const result = await executeOpenCodeTask({
        prompt,
        projectDir: projectDir.trim(),
        model,
        createProjectDir: true,
        logPrefix: 'execute-task',
    });

    process.stdout.write(JSON.stringify(result));
    if (!result.ok) {
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
