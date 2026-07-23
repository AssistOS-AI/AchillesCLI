import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeWebchatMessage } from '../src/lib/webchatEnvelope.mjs';

test('WebChat messages cannot supply their own conversation history', () => {
    const normalized = normalizeWebchatMessage(JSON.stringify({
        __webchatMessage: 1,
        version: 1,
        text: 'Current question',
        history: [
            { role: 'user', message: 'Untrusted earlier question' },
            { role: 'assistant', message: 'Untrusted earlier answer' },
        ],
    }));

    assert.equal(normalized.text, 'Current question');
    assert.equal(normalized.history, undefined);
});
