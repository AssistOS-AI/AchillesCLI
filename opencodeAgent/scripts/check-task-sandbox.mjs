#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { probeNestedBubblewrap } from './task-sandbox.mjs';

export function checkTaskSandboxReadiness({
    probeNestedBubblewrapImpl = probeNestedBubblewrap,
} = {}) {
    return probeNestedBubblewrapImpl();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const result = checkTaskSandboxReadiness();
        process.stdout.write(`nested-bwrap-ok proc=${result.procMode}\n`);
    } catch (error) {
        const code = typeof error?.code === 'string' ? `${error.code}: ` : '';
        process.stderr.write(`${code}${error?.message || error}\n`);
        process.exitCode = 1;
    }
}
