import assert from 'node:assert/strict';
import test from 'node:test';

import { unwrapToolPayload } from '../GPTResearcher/scripts/call-search-agent.mjs';

test('GPTResearcher unwraps SearchAgent MCP stdout and ignores stderr logs', () => {
    const payload = unwrapToolPayload({
        content: [
            {
                type: 'text',
                text: JSON.stringify({
                    ok: true,
                    results: [{
                        title: 'Solar System',
                        url: 'https://example.com/solar-system',
                        snippet: 'The Solar System has eight planets.',
                    }],
                }),
            },
            {
                type: 'text',
                text: 'stderr:\n{"event":"search_finish","provider":"searxng"}\n',
            },
        ],
        metadata: { agent: 'searchAgent' },
    });

    assert.deepEqual(payload, {
        ok: true,
        results: [{
            title: 'Solar System',
            url: 'https://example.com/solar-system',
            snippet: 'The Solar System has eight planets.',
        }],
    });
});
