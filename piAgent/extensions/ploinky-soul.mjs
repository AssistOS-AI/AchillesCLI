const MODELS = ['fast', 'plan', 'deep'].map((id) => ({
    id,
    name: `Soul ${id}`,
    reasoning: true,
    input: ['text', 'image'],
    cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
    },
    contextWindow: 200000,
    maxTokens: 32000,
}));

export default function registerPloinkySoul(pi) {
    const baseUrl = String(process.env.PLOINKY_TASK_BROKER_URL || '').trim();
    const apiKey = String(process.env.PLOINKY_TASK_BROKER_KEY || '').trim();
    if (!baseUrl || !apiKey) return;
    pi.registerProvider('ploinky-soul', {
        name: 'Ploinky Soul Gateway',
        baseUrl,
        apiKey: 'PLOINKY_TASK_BROKER_KEY',
        api: 'openai-completions',
        models: MODELS,
    });
}
