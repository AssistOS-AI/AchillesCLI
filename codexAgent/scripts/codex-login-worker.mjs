#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { updateLoginFlow } from './login-flow-store.mjs';
import { parseCodexDeviceLoginOutput, stripAnsi } from './codex-login-output.mjs';
import { resolveCodexBinary } from './codex-runner.mjs';

const [flowId, method] = process.argv.slice(2);
if (method !== 'device_code') throw new Error('unsupported_login_method');
const args = ['login', '--device-auth'];
const child = spawn(resolveCodexBinary(), args, {
    env: { ...process.env, HOME: process.env.HOME || '/root', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';

function publish(chunk) {
    output = `${output}${chunk}`.slice(-8000);
    const { cleaned, url, code } = parseCodexDeviceLoginOutput(output);
    updateLoginFlow(flowId, {
        status: 'running',
        ...(url ? { challenge: {
            type: 'device_code',
            url,
            verificationUri: url,
            ...(code ? { userCode: code } : {}),
            message: cleaned.trim().slice(-2000),
        } } : {}),
    });
}

child.stdout.on('data', (chunk) => publish(chunk.toString('utf8')));
child.stderr.on('data', (chunk) => publish(chunk.toString('utf8')));
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('error', (error) => {
    updateLoginFlow(flowId, { status: 'failed', error: String(error?.message || error).slice(0, 500) });
});
child.on('close', (code) => {
    updateLoginFlow(flowId, {
        status: code === 0 ? 'completed' : 'failed',
        ...(code === 0 ? { challenge: null } : { error: stripAnsi(output).trim().slice(-500) || `Codex login failed (${code}).` }),
    });
});
