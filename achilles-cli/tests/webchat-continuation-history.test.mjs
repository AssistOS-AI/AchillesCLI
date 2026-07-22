import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
    normalizeWebchatHistory,
    normalizeWebchatMessage,
} from '../src/lib/webchatEnvelope.mjs';

test('WebChat envelopes preserve prior turns as AgentLib role-message records', () => {
    const normalized = normalizeWebchatMessage(JSON.stringify({
        __webchatMessage: 1,
        version: 1,
        text: 'Current question',
        history: [
            { role: 'user', message: 'Earlier question', ignored: true },
            { role: 'assistant', message: 'Earlier answer' },
            { role: 'system', message: 'drop' },
            { role: 'user', message: '' },
        ],
    }));

    assert.equal(normalized.text, 'Current question');
    assert.deepEqual(normalized.history, [
        { role: 'user', message: 'Earlier question' },
        { role: 'assistant', message: 'Earlier answer' },
    ]);
    assert.doesNotMatch(normalized.text, /Ploinky conversation context|New user message/);
    assert.deepEqual(normalizeWebchatHistory(null), []);
    assert.deepEqual(normalizeWebchatMessage('Plain text').history, []);
});

test('WebChat entrypoint hydrates MainAgent and bypasses prompt-only cache on continuation', () => {
    const entrypoint = fs.readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8');
    assert.match(entrypoint, /const initialHistory = normalizedMessage\.history/);
    assert.match(entrypoint, /initialHistory\.length === 0[\s\S]*lookupCachedProviderResultForPrompt/);
    assert.match(entrypoint, /initialHistory\.length > 0 \? \{ initialHistory \} : \{\}/);
});
