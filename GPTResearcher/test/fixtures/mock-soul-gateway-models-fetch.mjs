globalThis.fetch = async (url, options = {}) => {
    if (String(url) !== 'http://127.0.0.1:8080/services/soul-gateway/v1/models') {
        throw new Error(`Unexpected URL: ${url}`);
    }
    if (options.headers?.Authorization !== 'Bearer test-key') {
        throw new Error('Missing test authorization header.');
    }
    return {
        ok: true,
        status: 200,
        async text() {
            return JSON.stringify({
                object: 'list',
                data: [
                    {
                        id: 'codex-api/gpt-5.4-mini',
                        object: 'model',
                        owned_by: 'codex-api',
                        root: 'codex-api/gpt-5.4-mini',
                        displayName: 'GPT 5.4 Mini',
                        _tags: ['chat'],
                    },
                    {
                        id: 'codestral/codestral-embed',
                        object: 'model',
                        owned_by: 'codestral',
                        root: 'codestral/codestral-embed',
                        displayName: 'Codestral Embed',
                        _tags: ['embeddings'],
                    },
                    {
                        id: 'agent:proxies/searchAgent/duckduckgo',
                        object: 'model',
                        owned_by: 'agent:proxies/searchAgent',
                        root: 'agent:proxies/searchAgent/duckduckgo',
                        _tags: ['search'],
                    },
                    {
                        id: 'agent:proxies/searchAgent/tavily',
                        object: 'model',
                        owned_by: 'agent:proxies/searchAgent',
                        root: 'agent:proxies/searchAgent/tavily',
                        _tags: ['search'],
                    },
                ],
            });
        },
    };
};
