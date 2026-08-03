#!/usr/bin/env node

import { probeNestedBubblewrap } from './task-sandbox.mjs';

try {
    const result = probeNestedBubblewrap();
    process.stdout.write(`nested-bwrap-ok proc=${result.procMode}\n`);
} catch (error) {
    const code = typeof error?.code === 'string' ? `${error.code}: ` : '';
    process.stderr.write(`${code}${error?.message || error}\n`);
    process.exitCode = 1;
}
