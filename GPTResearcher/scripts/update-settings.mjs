#!/usr/bin/env node

import { readStdinJson, writeSettings } from './settings.mjs';

try {
    const input = await readStdinJson();
    const settings = await writeSettings(input);
    process.stdout.write(JSON.stringify({
        ok: true,
        settings,
    }));
} catch (error) {
    process.stdout.write(JSON.stringify({
        ok: false,
        error: error?.message || 'Failed to update GPTResearcher settings.',
    }));
    process.exitCode = 1;
}
