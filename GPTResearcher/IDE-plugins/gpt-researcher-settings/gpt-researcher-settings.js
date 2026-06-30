const DEFAULT_SETTINGS = Object.freeze({
    fastLlm: 'ollama:llama3.1',
    smartLlm: 'ollama:llama3.1',
    strategicLlm: 'ollama:llama3.1',
    embedding: 'ollama:nomic-embed-text',
    retriever: 'duckduckgo',
    env: Object.freeze({
        OLLAMA_BASE_URL: 'http://host.containers.internal:11434',
        OPENAI_BASE_URL: '',
        AZURE_OPENAI_ENDPOINT: '',
        AZURE_OPENAI_API_VERSION: '',
        MISTRAL_BASE_URL: '',
        OPENROUTER_LIMIT_RPS: '',
        VLLM_OPENAI_API_BASE: '',
        AIMLAPI_BASE_URL: ''
    })
});

const ENV_INPUTS = Object.freeze({
    OLLAMA_BASE_URL: 'gptrEnvOllamaBaseUrl',
    OPENAI_BASE_URL: 'gptrEnvOpenaiBaseUrl',
    AZURE_OPENAI_ENDPOINT: 'gptrEnvAzureOpenaiEndpoint',
    AZURE_OPENAI_API_VERSION: 'gptrEnvAzureOpenaiApiVersion',
    MISTRAL_BASE_URL: 'gptrEnvMistralBaseUrl',
    OPENROUTER_LIMIT_RPS: 'gptrEnvOpenrouterLimitRps',
    VLLM_OPENAI_API_BASE: 'gptrEnvVllmOpenaiApiBase',
    AIMLAPI_BASE_URL: 'gptrEnvAimlapiBaseUrl'
});

const LOG_PREFIX = '[GPTResearcher Settings]';

function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function stringifyForLog(value) {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function getErrorMessage(error, fallback) {
    if (error instanceof Error) {
        return error.message || fallback;
    }
    if (typeof error === 'string' && error.trim()) {
        return error.trim();
    }
    return fallback;
}

function logError(context, error, extra = undefined) {
    console.error(`${LOG_PREFIX} ${context}`, {
        error,
        message: getErrorMessage(error, 'Unknown error.'),
        stack: error instanceof Error ? error.stack : undefined,
        extra
    });
}

function extractToolText(result) {
    if (typeof result === 'string') {
        return result;
    }
    if (Array.isArray(result?.content)) {
        return result.content
            .filter((entry) => entry && entry.type === 'text' && typeof entry.text === 'string')
            .map((entry) => entry.text)
            .join('\n')
            .trim();
    }
    if (typeof result?.text === 'string') {
        return result.text;
    }
    try {
        return JSON.stringify(result);
    } catch {
        return '';
    }
}

function parseToolPayload(result) {
    const text = extractToolText(result);
    if (!text) {
        console.error(`${LOG_PREFIX} MCP tool returned no text content.`, { result });
        return null;
    }
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
        console.error(`${LOG_PREFIX} Failed to parse MCP tool JSON payload.`, {
            text,
            result,
            error,
            stack: error instanceof Error ? error.stack : undefined
        });
        return null;
    }
}

function normalizeSettings(value = {}) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const envInput = input.env && typeof input.env === 'object' && !Array.isArray(input.env) ? input.env : {};
    const env = {};
    Object.keys(DEFAULT_SETTINGS.env).forEach((key) => {
        env[key] = trim(envInput[key] ?? DEFAULT_SETTINGS.env[key]);
    });
    return {
        fastLlm: trim(input.fastLlm) || DEFAULT_SETTINGS.fastLlm,
        smartLlm: trim(input.smartLlm) || DEFAULT_SETTINGS.smartLlm,
        strategicLlm: trim(input.strategicLlm) || DEFAULT_SETTINGS.strategicLlm,
        embedding: trim(input.embedding) || DEFAULT_SETTINGS.embedding,
        retriever: trim(input.retriever) || DEFAULT_SETTINGS.retriever,
        env
    };
}

export class GPTResearcherSettings {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
            activeTab: 'models',
            settings: normalizeSettings(),
            status: '',
            statusType: ''
        };
        this.mcpClient = null;
        this.mcpClientPromise = null;
        this.invalidate();
    }

    beforeRender() {}

    closeModal() {
        assistOS.UI.closeModal(this.element, null);
    }

    afterRender() {
        this.cacheElements();
        this.syncInputsFromState();
        this.renderTabs();
        this.renderStatus();
        void this.reloadSettings().catch((error) => {
            logError('Unhandled settings load failure.', error);
            this.setStatus(getErrorMessage(error, 'Load failed.'), 'error');
        });
    }

    cacheElements() {
        this.tabs = {
            models: this.element.querySelector('#gptrModelsTab'),
            providers: this.element.querySelector('#gptrProvidersTab')
        };
        this.panels = {
            models: this.element.querySelector('#gptrModelsPanel'),
            providers: this.element.querySelector('#gptrProvidersPanel')
        };
        this.inputs = {
            fastLlm: this.element.querySelector('#gptrFastLlm'),
            smartLlm: this.element.querySelector('#gptrSmartLlm'),
            strategicLlm: this.element.querySelector('#gptrStrategicLlm'),
            embedding: this.element.querySelector('#gptrEmbedding'),
            retriever: this.element.querySelector('#gptrRetriever'),
            env: {}
        };
        Object.entries(ENV_INPUTS).forEach(([key, id]) => {
            this.inputs.env[key] = this.element.querySelector(`#${id}`);
        });
        this.statusElement = this.element.querySelector('#gptrSettingsStatus');
    }

    async ensureMcpClient() {
        if (this.mcpClient) {
            return this.mcpClient;
        }
        if (this.mcpClientPromise) {
            return this.mcpClientPromise;
        }
        this.mcpClientPromise = (async () => {
            console.info(`${LOG_PREFIX} Importing MCP browser client.`);
            const module = await import('/MCPBrowserClient.js');
            if (!module || typeof module.createAgentClient !== 'function') {
                console.error(`${LOG_PREFIX} MCP browser client module shape is invalid.`, { module });
                throw new Error('MCP browser client module is unavailable.');
            }
            console.info(`${LOG_PREFIX} Creating MCP client.`, { endpoint: '/GPTResearcher/mcp' });
            this.mcpClient = module.createAgentClient('/GPTResearcher/mcp');
            return this.mcpClient;
        })();
        try {
            return await this.mcpClientPromise;
        } finally {
            this.mcpClientPromise = null;
        }
    }

    showTab(_target, tabName) {
        this.state.activeTab = tabName === 'providers' ? 'providers' : 'models';
        this.renderTabs();
    }

    renderTabs() {
        Object.entries(this.tabs || {}).forEach(([key, tab]) => {
            const active = key === this.state.activeTab;
            tab?.classList.toggle('active', active);
            tab?.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        Object.entries(this.panels || {}).forEach(([key, panel]) => {
            const active = key === this.state.activeTab;
            panel?.classList.toggle('active', active);
            if (panel) panel.hidden = !active;
        });
    }

    syncInputsFromState() {
        const settings = normalizeSettings(this.state.settings);
        if (this.inputs?.fastLlm) this.inputs.fastLlm.value = settings.fastLlm;
        if (this.inputs?.smartLlm) this.inputs.smartLlm.value = settings.smartLlm;
        if (this.inputs?.strategicLlm) this.inputs.strategicLlm.value = settings.strategicLlm;
        if (this.inputs?.embedding) this.inputs.embedding.value = settings.embedding;
        if (this.inputs?.retriever) this.inputs.retriever.value = settings.retriever;
        Object.keys(DEFAULT_SETTINGS.env).forEach((key) => {
            if (this.inputs?.env?.[key]) {
                this.inputs.env[key].value = settings.env[key] || '';
            }
        });
    }

    collectSettingsFromInputs() {
        const env = {};
        Object.keys(DEFAULT_SETTINGS.env).forEach((key) => {
            env[key] = trim(this.inputs?.env?.[key]?.value);
        });
        return normalizeSettings({
            fastLlm: this.inputs?.fastLlm?.value,
            smartLlm: this.inputs?.smartLlm?.value,
            strategicLlm: this.inputs?.strategicLlm?.value,
            embedding: this.inputs?.embedding?.value,
            retriever: this.inputs?.retriever?.value,
            env
        });
    }

    setStatus(message, type = '') {
        this.state.status = message;
        this.state.statusType = type;
        this.renderStatus();
    }

    renderStatus() {
        if (!this.statusElement) {
            return;
        }
        this.statusElement.textContent = this.state.status || '';
        this.statusElement.classList.toggle('error', this.state.statusType === 'error');
        this.statusElement.classList.toggle('success', this.state.statusType === 'success');
    }

    async reloadSettings() {
        this.setStatus('Loading...');
        try {
            const client = await this.ensureMcpClient();
            console.info(`${LOG_PREFIX} Calling gpt_researcher_get_settings.`);
            const result = await client.callTool('gpt_researcher_get_settings', {});
            console.info(`${LOG_PREFIX} Raw get settings MCP result.`, result);
            const payload = parseToolPayload(result);
            console.info(`${LOG_PREFIX} Parsed get settings payload.`, payload);
            if (!payload?.ok) {
                throw new Error(payload?.error || `Invalid settings payload: ${stringifyForLog(payload)}`);
            }
            this.state.settings = normalizeSettings(payload.settings);
            this.syncInputsFromState();
            this.setStatus('');
        } catch (error) {
            logError('Failed to load settings.', error);
            this.setStatus(getErrorMessage(error, 'Load failed.'), 'error');
            throw error;
        }
    }

    async saveSettings() {
        this.setStatus('Saving...');
        try {
            const settings = this.collectSettingsFromInputs();
            const client = await this.ensureMcpClient();
            console.info(`${LOG_PREFIX} Calling gpt_researcher_update_settings.`, { settings });
            const result = await client.callTool('gpt_researcher_update_settings', settings);
            console.info(`${LOG_PREFIX} Raw update settings MCP result.`, result);
            const payload = parseToolPayload(result);
            console.info(`${LOG_PREFIX} Parsed update settings payload.`, payload);
            if (!payload?.ok) {
                throw new Error(payload?.error || `Invalid settings payload: ${stringifyForLog(payload)}`);
            }
            this.state.settings = normalizeSettings(payload.settings);
            this.syncInputsFromState();
            this.setStatus('Saved.', 'success');
        } catch (error) {
            logError('Failed to save settings.', error, {
                attemptedSettings: this.collectSettingsFromInputs()
            });
            this.setStatus(getErrorMessage(error, 'Save failed.'), 'error');
            throw error;
        }
    }
}
