import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCodexDeviceLoginOutput } from '../scripts/codex-login-output.mjs';

const prefix = `Welcome to Codex [v0.146.0]

Follow these steps to sign in with ChatGPT using device code authorization:

1. Open this link in your browser and sign in to your account
   https://auth.openai.com/codex/device\u001b[0m
`;

test('Codex device login never treats the authorization label as the user code', () => {
    const parsed = parseCodexDeviceLoginOutput(prefix);

    assert.equal(parsed.url, 'https://auth.openai.com/codex/device');
    assert.equal(parsed.code, '');
});

test('Codex device login extracts the real code from its labeled step', () => {
    const parsed = parseCodexDeviceLoginOutput(`${prefix}
2. Enter this one-time code (expires in 15 minutes)
   ZKIH-TVK34\u001b[0m
`);

    assert.equal(parsed.url, 'https://auth.openai.com/codex/device');
    assert.equal(parsed.code, 'ZKIH-TVK34');
    assert.equal(parsed.cleaned.includes('\u001b'), false);
});
