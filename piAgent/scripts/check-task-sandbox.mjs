#!/usr/bin/env node

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

import { resolvePiBinary } from './execute-task.mjs';
import {
    buildTaskSandboxLaunch,
    probeNestedBubblewrap,
} from './task-sandbox.mjs';

try {
    const result = probeNestedBubblewrap();
    const env = {
        ...process.env,
        HOME: '/root',
        PI_OFFLINE: '1',
        PI_SKIP_VERSION_CHECK: '1',
    };
    const piBinary = resolvePiBinary(env);
    const launch = buildTaskSandboxLaunch({
        projectDir: process.env.PLOINKY_WORKSPACE_ROOT,
        command: piBinary,
        args: ['--version'],
        env,
        readOnlyPaths: ['/root/.local'].filter((candidate) => fs.existsSync(candidate)),
        writablePaths: ['/root/.pi/agent'].filter((candidate) => fs.existsSync(candidate)),
    });
    const commandProbe = spawnSync(launch.command, launch.args, {
        cwd: launch.cwd,
        env,
        encoding: 'utf8',
        timeout: 10_000,
    });
    if (commandProbe.status !== 0 || commandProbe.error) {
        const outcome = commandProbe.error?.code
            || commandProbe.signal
            || `exit ${commandProbe.status ?? 'unknown'}`;
        throw new Error(`sandboxed PI startup probe failed (${outcome})`);
    }
    process.stdout.write(`nested-bwrap-ok proc=${result.procMode} pi=ok\n`);
} catch (error) {
    const code = typeof error?.code === 'string' ? `${error.code}: ` : '';
    process.stderr.write(`${code}${error?.message || error}\n`);
    process.exitCode = 1;
}
