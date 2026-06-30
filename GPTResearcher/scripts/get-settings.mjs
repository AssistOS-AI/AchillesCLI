#!/usr/bin/env node

import { readSettings } from './settings.mjs';

try {
    const settings = await readSettings();
    process.stdout.write(JSON.stringify({
        ok: true,
        settings,
    }));
} catch (error) {
    process.stdout.write(JSON.stringify({
        ok: false,
        error: error?.message || 'Failed to read GPTResearcher settings.',
    }));
    process.exitCode = 1;
}
