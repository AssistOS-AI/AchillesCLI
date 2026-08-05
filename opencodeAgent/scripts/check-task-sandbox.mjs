#!/usr/bin/env node

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

import { resolveOpenCodeBin } from './opencode-runner.mjs';
import {
    buildTaskSandboxLaunch,
    probeNestedBubblewrap,
} from './task-sandbox.mjs';

try {
    const result = probeNestedBubblewrap();
    const env = { ...process.env, HOME: '/root' };
    const opencodeBin = resolveOpenCodeBin(env);
    const launch = buildTaskSandboxLaunch({
        projectDir: process.env.PLOINKY_WORKSPACE_ROOT,
        command: opencodeBin,
        args: ['--version'],
        env,
        readOnlyPaths: ['/root/.opencode'].filter((candidate) => fs.existsSync(candidate)),
        writablePaths: [
            '/root/.config/opencode',
            '/root/.cache/opencode',
            '/root/.local/share/opencode',
            '/root/.local/state/opencode',
        ].filter((candidate) => fs.existsSync(candidate)),
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
        throw new Error(`sandboxed OpenCode startup probe failed (${outcome})`);
    }
    process.stdout.write(`nested-bwrap-ok proc=${result.procMode} opencode=ok\n`);
} catch (error) {
    const code = typeof error?.code === 'string' ? `${error.code}: ` : '';
    process.stderr.write(`${code}${error?.message || error}\n`);
    process.exitCode = 1;
}
