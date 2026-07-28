#!/usr/bin/env node

import { probeNestedBubblewrap } from './task-sandbox.mjs';

try {
    const result = probeNestedBubblewrap();
    process.stdout.write(`nested-bwrap-ok proc=${result.procMode}\n`);
} catch (error) {
    process.stderr.write(`${error?.message || error}\n`);
    process.exitCode = 1;
}
