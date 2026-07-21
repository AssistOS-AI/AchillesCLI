#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runBrokeredMainAgent } from './broker/AchillesBroker.mjs';
import { normalizePermissionMode, PERMISSION_MODES } from './permissions/protocol.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    const argv = process.argv.slice(2);
    const options = parseBrokerBootstrapOptions(argv);
    fs.mkdirSync(options.workingDir, { recursive: true });
    const exitCode = await runBrokeredMainAgent({
        workspace: options.workingDir,
        argv,
        entryPath: path.join(__dirname, 'index.mjs'),
        webchat: isWebchatRuntime(),
        permissionMode: options.permissionMode,
        extraReadOnlyPaths: options.skillRoots,
    });
    process.exitCode = exitCode;
}

export function parseBrokerBootstrapOptions(args) {
    let workingDir = process.cwd();
    let permissionMode = PERMISSION_MODES.ASK;
    const skillRoots = [];
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--dir' || arg === '-d') {
            workingDir = path.resolve(args[index + 1] || process.cwd());
            index += 1;
        } else if (arg.startsWith('--dir=')) {
            workingDir = path.resolve(arg.slice('--dir='.length) || process.cwd());
        } else if (arg === '--skill-root' || arg === '-r') {
            const root = args[index + 1];
            if (root && !root.startsWith('-')) {
                skillRoots.push(path.resolve(root));
                index += 1;
            }
        } else if (arg.startsWith('--skill-root=')) {
            skillRoots.push(path.resolve(arg.slice('--skill-root='.length)));
        } else if (arg === '--permissions') {
            const requested = normalizePermissionMode(args[index + 1]);
            if (!requested) throw new Error('Use --permissions ask-for-approval or --permissions full-access.');
            permissionMode = requested;
            index += 1;
        } else if (arg.startsWith('--permissions=')) {
            const requested = normalizePermissionMode(arg.slice('--permissions='.length));
            if (!requested) throw new Error('Use --permissions ask-for-approval or --permissions full-access.');
            permissionMode = requested;
        } else if (arg === '--skip-permissions') {
            permissionMode = PERMISSION_MODES.FULL;
        }
    }
    return { workingDir, permissionMode, skillRoots };
}

function isWebchatRuntime() {
    return [
        'SSO_USER',
        'SSO_USER_ID',
        'SSO_EMAIL',
        'SSO_ROLES',
        'SSO_SESSION_ID',
    ].some((key) => String(process.env[key] || '').trim())
        || process.argv.some((arg) => typeof arg === 'string' && arg.startsWith('--sso-'));
}

main().catch((error) => {
    console.error('Fatal error:', error.message);
    process.exitCode = 1;
});
