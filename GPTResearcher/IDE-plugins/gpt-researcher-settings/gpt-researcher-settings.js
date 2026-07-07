const DEFAULT_SETTINGS = Object.freeze({
    fastLlm: 'codex-api/gpt-5.4-mini',
    smartLlm: 'codex-api/gpt-5.5',
    strategicLlm: 'codex-api/gpt-5.4-mini',
    embedding: 'codestral-embed',
    searchProvider: 'duckduckgo',
    reportSource: 'web'
});

const LOG_PREFIX = '[GPTResearcher Settings]';
const MODEL_FIELDS = Object.freeze(['fastLlm', 'smartLlm', 'strategicLlm', 'embedding', 'searchProvider']);
const REPORT_SOURCES = new Set(['web', 'local', 'hybrid']);
const REPORT_SOURCE_HELP = Object.freeze({
    web: 'Uses only internet sources through the selected search provider.',
    local: 'Uses only local files from this agent workspace folder.',
    hybrid: 'Uses both local files from this agent workspace folder and internet sources.'
});

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
        if (text.startsWith('MCP error')) {
            throw new Error(text);
        }
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
    const reportSource = trim(input.reportSource) || DEFAULT_SETTINGS.reportSource;
    return {
        fastLlm: trim(input.fastLlm) || DEFAULT_SETTINGS.fastLlm,
        smartLlm: trim(input.smartLlm) || DEFAULT_SETTINGS.smartLlm,
        strategicLlm: trim(input.strategicLlm) || DEFAULT_SETTINGS.strategicLlm,
        embedding: trim(input.embedding) || DEFAULT_SETTINGS.embedding,
        searchProvider: trim(input.searchProvider) || DEFAULT_SETTINGS.searchProvider,
        reportSource: REPORT_SOURCES.has(reportSource) ? reportSource : DEFAULT_SETTINGS.reportSource
    };
}

function normalizeModel(value = {}) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const id = trim(input.id);
    if (!id) return null;
    const model = {
        id,
        label: trim(input.label) || id,
        providerKey: trim(input.providerKey) || 'soul-gateway',
        providerLabel: trim(input.providerLabel) || trim(input.providerKey) || 'soul-gateway',
        providerModelId: trim(input.providerModelId),
        tags: Array.isArray(input.tags) ? input.tags.map((tag) => trim(tag)).filter(Boolean) : [],
        capabilities: input.capabilities && typeof input.capabilities === 'object' && !Array.isArray(input.capabilities)
            ? input.capabilities
            : {},
        isEmbedding: input.isEmbedding === true,
        isSearch: input.isSearch === true,
        configured: input.configured !== false,
        requiredEnv: normalizeEnvStatus(input.requiredEnv),
    };
    model.searchText = [
        model.id,
        model.label,
        model.providerKey,
        model.providerLabel,
        model.providerModelId,
        ...model.tags
    ].join(' ').toLowerCase();
    return model;
}

function normalizeEnvStatus(value) {
    return Array.isArray(value)
        ? value
            .map((item) => ({
                name: trim(item?.name || item?.key || item),
                configured: item && typeof item === 'object' ? item.configured === true : false
            }))
            .filter((item) => item.name)
        : [];
}

function normalizeModelPayload(value = {}) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const models = Array.isArray(input.models) ? input.models.map(normalizeModel).filter(Boolean) : [];
    const chatModels = Array.isArray(input.chatModels)
        ? input.chatModels.map(normalizeModel).filter(Boolean)
        : models.filter((model) => !model.isEmbedding);
    const embeddingModels = Array.isArray(input.embeddingModels)
        ? input.embeddingModels.map(normalizeModel).filter(Boolean)
        : models.filter((model) => model.isEmbedding);
    const searchProviders = Array.isArray(input.searchProviders)
        ? input.searchProviders.map(normalizeModel).filter(Boolean)
        : models.filter((model) => model.isSearch);
    return { models, chatModels, embeddingModels, searchProviders };
}

function searchTextForModel(model) {
    return model.searchText || model.id.toLowerCase();
}

function modelMatchesSearch(model, query) {
    const terms = trim(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const haystack = searchTextForModel(model);
    return terms.every((term) => haystack.includes(term));
}

function groupModelsByProvider(models) {
    const groups = new Map();
    for (const model of models) {
        const key = model.providerKey || 'soul-gateway';
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                label: model.providerLabel || key,
                models: []
            });
        }
        groups.get(key).models.push(model);
    }
    return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export class GPTResearcherSettings {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.state = {
            settings: normalizeSettings(),
            models: normalizeModelPayload(),
            status: '',
            statusType: ''
        };
        this.mcpClient = null;
        this.mcpClientPromise = null;
        this.modelOptionsPointerDown = new Set();
        this.boundModelEvents = false;
        this.invalidate();
    }

    beforeRender() {}

    closeModal() {
        assistOS.UI.closeModal(this.element, null);
    }

    afterRender() {
        this.cacheElements();
        this.syncInputsFromState();
        this.renderStatus();
        void this.loadInitialData();
    }

    cacheElements() {
        this.inputs = {
            fastLlm: this.element.querySelector('#gptrFastLlm'),
            smartLlm: this.element.querySelector('#gptrSmartLlm'),
            strategicLlm: this.element.querySelector('#gptrStrategicLlm'),
            embedding: this.element.querySelector('#gptrEmbedding'),
            searchProvider: this.element.querySelector('#gptrSearchProvider'),
            reportSource: this.element.querySelector('#gptrReportSource')
        };
        this.modelOptionLists = {
            fastLlm: this.element.querySelector('[data-options-for="fastLlm"]'),
            smartLlm: this.element.querySelector('[data-options-for="smartLlm"]'),
            strategicLlm: this.element.querySelector('[data-options-for="strategicLlm"]'),
            embedding: this.element.querySelector('[data-options-for="embedding"]'),
            searchProvider: this.element.querySelector('[data-options-for="searchProvider"]')
        };
        this.modelToggles = {
            fastLlm: this.element.querySelector('[data-model-toggle="fastLlm"]'),
            smartLlm: this.element.querySelector('[data-model-toggle="smartLlm"]'),
            strategicLlm: this.element.querySelector('[data-model-toggle="strategicLlm"]'),
            embedding: this.element.querySelector('[data-model-toggle="embedding"]'),
            searchProvider: this.element.querySelector('[data-model-toggle="searchProvider"]')
        };
        for (const field of MODEL_FIELDS) {
            this.bindModelCombobox(field);
        }
        this.inputs.searchProvider?.addEventListener('change', () => this.renderSearchProviderHelp());
        this.inputs.reportSource?.addEventListener('change', () => this.renderReportSourceHelp());
        this.searchProviderHelpElement = this.element.querySelector('#gptrSearchProviderHelp');
        this.reportSourceHelpElement = this.element.querySelector('#gptrReportSourceHelp');
        this.statusElement = this.element.querySelector('#gptrSettingsStatus');
    }

    bindModelCombobox(field) {
        const input = this.inputs?.[field];
        const options = this.modelOptionLists?.[field];
        if (!input) return;
        input.addEventListener('focus', () => this.renderModelOptions(field, true, { showAll: true }));
        input.addEventListener('input', () => {
            this.renderModelOptions(field, true);
            if (field === 'searchProvider') {
                this.renderSearchProviderHelp();
            }
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                this.closeModelOptions(field);
            }
        });
        input.addEventListener('blur', () => {
            window.setTimeout(() => {
                if (!this.modelOptionsPointerDown.has(field)) {
                    this.closeModelOptions(field);
                }
            }, 120);
        });
        options?.addEventListener('mousedown', () => {
            this.modelOptionsPointerDown.add(field);
        });
        this.modelToggles?.[field]?.addEventListener('mousedown', (event) => {
            event.preventDefault();
            if (document.activeElement !== input) {
                input.focus();
                return;
            }
            this.renderModelOptions(field, true, { showAll: true });
        });
        if (!this.boundModelEvents) {
            this.boundModelEvents = true;
            window.addEventListener('mouseup', () => this.modelOptionsPointerDown.clear());
        }
    }

    async ensureMcpClient() {
        if (this.mcpClient) {
            return this.mcpClient;
        }
        if (this.mcpClientPromise) {
            return this.mcpClientPromise;
        }
        this.mcpClientPromise = (async () => {
            const module = await import('/MCPBrowserClient.js');
            if (!module || typeof module.createAgentClient !== 'function') {
                console.error(`${LOG_PREFIX} MCP browser client module shape is invalid.`, { module });
                throw new Error('MCP browser client module is unavailable.');
            }
            this.mcpClient = module.createAgentClient('/GPTResearcher/mcp');
            return this.mcpClient;
        })();
        try {
            return await this.mcpClientPromise;
        } finally {
            this.mcpClientPromise = null;
        }
    }

    openResearcherUi() {
        const { protocol, port } = window.location;
        const portPart = port ? `:${port}` : '';
        const url = `${protocol}//gptresearcher.localhost${portPart}/`;
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    async loadInitialData() {
        this.setStatus('Loading...');
        const [settingsResult, modelsResult] = await Promise.allSettled([
            this.reloadSettings({ quiet: true }),
            this.reloadModels({ quiet: true })
        ]);
        const errors = [];
        if (settingsResult.status === 'rejected') {
            logError('Unhandled settings load failure.', settingsResult.reason);
            errors.push(getErrorMessage(settingsResult.reason, 'Settings load failed.'));
        }
        if (modelsResult.status === 'rejected') {
            logError('Unhandled model list load failure.', modelsResult.reason);
            errors.push(getErrorMessage(modelsResult.reason, 'Model list load failed.'));
        }
        if (errors.length) {
            this.setStatus(errors.join(' '), 'error');
            return;
        }
        this.setStatus('');
    }

    syncInputsFromState() {
        const settings = normalizeSettings(this.state.settings);
        if (this.inputs?.fastLlm) this.inputs.fastLlm.value = settings.fastLlm;
        if (this.inputs?.smartLlm) this.inputs.smartLlm.value = settings.smartLlm;
        if (this.inputs?.strategicLlm) this.inputs.strategicLlm.value = settings.strategicLlm;
        if (this.inputs?.embedding) this.inputs.embedding.value = settings.embedding;
        if (this.inputs?.searchProvider) this.inputs.searchProvider.value = settings.searchProvider;
        if (this.inputs?.reportSource) this.inputs.reportSource.value = settings.reportSource;
        this.renderSearchProviderHelp();
        this.renderReportSourceHelp();
        for (const field of MODEL_FIELDS) {
            this.closeModelOptions(field);
        }
    }

    renderSearchProviderHelp() {
        if (!this.searchProviderHelpElement) return;
        const providerId = trim(this.inputs?.searchProvider?.value);
        const provider = (this.state.models.searchProviders || []).find((item) => item.id === providerId);
        this.searchProviderHelpElement.textContent = '';
        if (!providerId) {
            return;
        }
        if (!provider) {
            this.searchProviderHelpElement.textContent = 'Provider metadata is not loaded yet.';
            return;
        }
        const keys = provider.requiredEnv || [];
        if (!keys.length) {
            this.searchProviderHelpElement.textContent = 'No required API key.';
            return;
        }
        const fragment = document.createDocumentFragment();
        const hasMissingRequired = keys.some((key) => !key.configured);
        for (const key of keys) {
            fragment.appendChild(this.createEnvStatusElement(key.name, key.configured, false));
        }
        if (hasMissingRequired) {
            const note = document.createElement('span');
            note.className = 'gptr-env-status-note';
            note.textContent = 'Set api keys in searchAgent as env variables.';
            fragment.appendChild(note);
        }
        this.searchProviderHelpElement.appendChild(fragment);
    }

    createEnvStatusElement(name, configured) {
        const item = document.createElement('span');
        item.className = `gptr-env-status ${configured ? 'configured' : 'missing'}`;
        const icon = document.createElement('span');
        icon.className = 'gptr-env-status-icon';
        icon.textContent = configured ? '✓' : 'x';
        const text = document.createElement('span');
        text.textContent = `${name} ${configured ? 'configured' : 'not configured'}`;
        item.append(icon, text);
        return item;
    }

    renderReportSourceHelp() {
        if (!this.reportSourceHelpElement) return;
        const source = trim(this.inputs?.reportSource?.value) || DEFAULT_SETTINGS.reportSource;
        this.reportSourceHelpElement.textContent = REPORT_SOURCE_HELP[source] || REPORT_SOURCE_HELP.web;
    }

    collectSettingsFromInputs() {
        return normalizeSettings({
            fastLlm: this.inputs?.fastLlm?.value,
            smartLlm: this.inputs?.smartLlm?.value,
            strategicLlm: this.inputs?.strategicLlm?.value,
            embedding: this.inputs?.embedding?.value,
            searchProvider: this.inputs?.searchProvider?.value,
            reportSource: this.inputs?.reportSource?.value
        });
    }

    getModelsForField(field) {
        if (field === 'embedding') {
            return this.state.models.embeddingModels || [];
        }
        if (field === 'searchProvider') {
            return this.state.models.searchProviders || [];
        }
        return this.state.models.chatModels || [];
    }

    closeModelOptions(field) {
        const options = this.modelOptionLists?.[field];
        if (!options) return;
        options.classList.remove('open');
        const anyOpen = MODEL_FIELDS.some((item) => this.modelOptionLists?.[item]?.classList.contains('open'));
        this.element.classList.toggle('gptr-model-menu-open', anyOpen);
    }

    renderModelOptions(field, open = false, optionsState = {}) {
        const input = this.inputs?.[field];
        const options = this.modelOptionLists?.[field];
        if (!input || !options) return;
        if (!open) {
            this.closeModelOptions(field);
            return;
        }
        options.textContent = '';
        const query = optionsState.showAll ? '' : input.value;
        const models = this.getModelsForField(field).filter((model) => modelMatchesSearch(model, query));
        if (!models.length) {
            const empty = document.createElement('div');
            empty.className = 'gptr-model-empty';
            if (field === 'embedding') {
                empty.textContent = 'No matching embedding models.';
            } else if (field === 'searchProvider') {
                empty.textContent = 'No matching search providers.';
            } else {
                empty.textContent = 'No matching models.';
            }
            options.appendChild(empty);
            options.classList.toggle('open', open);
            return;
        }
        const groups = groupModelsByProvider(models);
        const fragment = document.createDocumentFragment();
        for (const group of groups) {
            const groupElement = document.createElement('div');
            groupElement.className = 'gptr-model-group';
            const title = document.createElement('div');
            title.className = 'gptr-model-group-title';
            title.textContent = group.label;
            groupElement.appendChild(title);
            for (const model of group.models) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'gptr-model-option';
                if (model.id === trim(input.value)) {
                    button.classList.add('selected');
                }
                button.addEventListener('mousedown', (event) => {
                    event.preventDefault();
                    input.value = model.id;
                    if (field === 'searchProvider') {
                        this.renderSearchProviderHelp();
                    }
                    this.closeModelOptions(field);
                });
                const main = document.createElement('span');
                main.className = 'gptr-model-option-main';
                main.textContent = model.id;
                button.append(main);
                groupElement.appendChild(button);
            }
            fragment.appendChild(groupElement);
        }
        options.appendChild(fragment);
        options.classList.toggle('open', open);
        this.element.classList.toggle('gptr-model-menu-open', open);
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

    async reloadSettings({ quiet = false } = {}) {
        if (!quiet) this.setStatus('Loading...');
        try {
            const client = await this.ensureMcpClient();
            const result = await client.callTool('gpt_researcher_get_settings', {});
            const payload = parseToolPayload(result);
            if (!payload?.ok) {
                throw new Error(payload?.error || `Invalid settings payload: ${stringifyForLog(payload)}`);
            }
            this.state.settings = normalizeSettings(payload.settings);
            this.syncInputsFromState();
            if (!quiet) this.setStatus('');
        } catch (error) {
            logError('Failed to load settings.', error);
            if (!quiet) this.setStatus(getErrorMessage(error, 'Load failed.'), 'error');
            throw error;
        }
    }

    async reloadModels({ quiet = false } = {}) {
        if (!quiet) this.setStatus('Loading models...');
        try {
            const client = await this.ensureMcpClient();
            const result = await client.callTool('gpt_researcher_list_models', {});
            const payload = parseToolPayload(result);
            if (!payload?.ok) {
                throw new Error(payload?.error || `Invalid models payload: ${stringifyForLog(payload)}`);
            }
            this.state.models = normalizeModelPayload(payload);
            for (const field of MODEL_FIELDS) {
                this.closeModelOptions(field);
            }
            this.renderSearchProviderHelp();
            if (!quiet) this.setStatus('');
        } catch (error) {
            logError('Failed to load GPTResearcher model/provider options.', error);
            if (!quiet) this.setStatus(getErrorMessage(error, 'Model load failed.'), 'error');
            throw error;
        }
    }

    async saveSettings() {
        this.setStatus('Saving...');
        try {
            const settings = this.collectSettingsFromInputs();
            const client = await this.ensureMcpClient();
            const result = await client.callTool('gpt_researcher_update_settings', settings);
            const payload = parseToolPayload(result);
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
