export async function action(args = {}) {
    const prompt = typeof args.prompt === 'string'
        ? args.prompt.trim()
        : typeof args.promptText === 'string'
        ? args.promptText.trim()
        : '';
    const context = args.context && typeof args.context === 'object' ? args.context : {};
    const result = {
        ok: false,
        backend: 'web-search',
        cacheable: false,
        result_text: 'Web search is not deployed for this Copilot workspace yet. I cannot look up current online information from here.',
        persistence_hint: {
            ku_type: 'agent.result.web-search',
            record_result: false,
            ttl_hint_seconds: null,
        },
        diagnostics: {
            providerAvailability: 'disabled',
            promptProvided: Boolean(prompt),
        },
    };
    if (context && typeof context === 'object') {
        if (!Array.isArray(context.providerLauncherResults)) {
            context.providerLauncherResults = [];
        }
        context.providerLauncherResults.push({
            launcher: 'launch-web-search',
            backend: 'web-search',
            prompt,
            result,
        });
    }
    return result;
}
