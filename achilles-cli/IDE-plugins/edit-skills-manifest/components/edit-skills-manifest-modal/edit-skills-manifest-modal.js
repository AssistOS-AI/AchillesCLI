import { callExplorerTool } from '/explorer/services/infrastructure/explorerApi.js';
import * as skillsManifestUtils from '../../skills-manifest-utils.mjs';

const {
    buildSkillsManifestPath,
    isMissingManifestError,
    parseSkillsManifest,
    serializeSkillsManifest,
    validateRepositoryUrl
} = skillsManifestUtils;

const PRECONFIGURED_SKILL_REPOSITORIES = skillsManifestUtils.PRECONFIGURED_SKILL_REPOSITORIES || Object.freeze([
    {
        label: 'Achilles Copilot Basic Skills',
        url: 'https://github.com/AssistOS-AI/AchillesCopilotBasicSkills.git'
    }
]);

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export class EditSkillsManifestModal {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.folderPath = String(element.dataset.folderPath || element.getAttribute('data-folder-path') || '').trim();
        this.manifestPath = String(element.dataset.manifestPath || element.getAttribute('data-manifest-path') || '').trim() || buildSkillsManifestPath(this.folderPath);
        this.repositories = [];
        this.manifestExists = false;
        this.changed = false;
        this.loadFailed = false;
        this.boundSubmit = (event) => {
            event.preventDefault();
            void this.addRepository();
        };
        this.boundClick = this.handleClick.bind(this);
        this.invalidate();
    }

    beforeRender() {}

    async afterRender() {
        this.cacheElements();
        this.form?.removeEventListener('submit', this.boundSubmit);
        this.form?.addEventListener('submit', this.boundSubmit);
        if (!this.element.dataset.editSkillsManifestBound) {
            this.element.addEventListener('click', this.boundClick);
            this.element.dataset.editSkillsManifestBound = 'true';
        }
        await this.loadManifest();
        this.input?.focus();
    }

    afterUnload() {
        this.form?.removeEventListener('submit', this.boundSubmit);
        this.element?.removeEventListener('click', this.boundClick);
        if (this.element?.dataset) {
            delete this.element.dataset.editSkillsManifestBound;
        }
    }

    cacheElements() {
        this.pathEl = this.element.querySelector('[data-manifest-path]');
        this.form = this.element.querySelector('[data-add-form]');
        this.input = this.element.querySelector('#editSkillsManifestRepoInput');
        this.statusEl = this.element.querySelector('[data-status]');
        this.listEl = this.element.querySelector('[data-repository-list]');
        this.presetListEl = this.element.querySelector('[data-preset-list]');
        if (this.pathEl) {
            this.pathEl.textContent = this.manifestPath || 'ploinky-skills-manifest.json';
        }
        this.renderPresets();
    }

    async loadManifest() {
        if (!this.manifestPath) {
            this.setStatus('Missing target folder for skills manifest.', 'error');
            this.loadFailed = true;
            return;
        }

        try {
            const raw = await callExplorerTool('read_text_file', { path: this.manifestPath });
            this.repositories = parseSkillsManifest(raw);
            this.manifestExists = true;
            this.setStatus('', '');
        } catch (error) {
            if (isMissingManifestError(error)) {
                this.repositories = [];
                this.manifestExists = false;
                this.setStatus('No skills manifest exists in this folder yet.', 'info');
            } else {
                this.loadFailed = true;
                this.setStatus(error?.message || 'Could not read skills manifest.', 'error');
            }
        }

        this.renderList();
        this.renderPresets();
    }

    renderPresets() {
        if (!this.presetListEl) return;
        this.presetListEl.innerHTML = PRECONFIGURED_SKILL_REPOSITORIES.map((repository, index) => {
            const alreadyAdded = this.repositories.includes(repository.url);
            return `
                <div class="edit-skills-manifest-preset-row">
                    <div>
                        <div class="edit-skills-manifest-preset-name">${escapeHtml(repository.label)}</div>
                        <div class="edit-skills-manifest-preset-url">${escapeHtml(repository.url)}</div>
                    </div>
                    <button class="general-button edit-skills-manifest-preset-add" type="button" data-preset-index="${index}" ${alreadyAdded ? 'disabled' : ''}>${alreadyAdded ? 'Added' : 'Add'}</button>
                </div>
            `;
        }).join('');
    }

    setStatus(message, type = '') {
        if (!this.statusEl) return;
        this.statusEl.textContent = message;
        this.statusEl.hidden = !message;
        this.statusEl.classList.toggle('is-error', type === 'error');
        this.statusEl.classList.toggle('is-info', type === 'info');
    }

    renderList() {
        if (!this.listEl) return;
        if (!this.repositories.length) {
            this.listEl.innerHTML = '<div class="edit-skills-manifest-empty">No skill repositories configured.</div>';
            return;
        }

        this.listEl.innerHTML = this.repositories.map((repository, index) => `
            <div class="edit-skills-manifest-row">
                <div class="edit-skills-manifest-url">${escapeHtml(repository)}</div>
                <button class="edit-skills-manifest-remove" type="button" title="Remove repository" aria-label="Remove repository" data-repository-index="${index}">x</button>
            </div>
        `).join('');
    }

    handleClick(event) {
        const presetButton = event.target?.closest?.('[data-preset-index]');
        if (presetButton && this.element.contains(presetButton)) {
            event.preventDefault();
            if (!presetButton.disabled) {
                void this.addPresetRepository(presetButton.dataset.presetIndex);
            }
            return;
        }

        const removeButton = event.target?.closest?.('[data-repository-index]');
        if (removeButton && this.element.contains(removeButton)) {
            event.preventDefault();
            void this.removeRepository(removeButton.dataset.repositoryIndex);
        }
    }

    async writeManifest() {
        await callExplorerTool('write_file', {
            path: this.manifestPath,
            content: serializeSkillsManifest(this.repositories)
        });
        this.manifestExists = true;
        this.changed = true;
    }

    async addRepository() {
        if (this.loadFailed) {
            this.setStatus('Fix the manifest file before editing it here.', 'error');
            return;
        }
        const validation = validateRepositoryUrl(this.input?.value || '', this.repositories);
        if (!validation.ok) {
            this.setStatus(validation.error, 'error');
            return;
        }

        this.repositories = [...this.repositories, validation.value];
        try {
            await this.writeManifest();
            if (this.input) {
                this.input.value = '';
                this.input.focus();
            }
            this.setStatus('Repository added.', 'info');
            this.renderList();
            this.renderPresets();
        } catch (error) {
            this.repositories = this.repositories.filter((entry) => entry !== validation.value);
            this.setStatus(error?.message || 'Could not write skills manifest.', 'error');
            this.renderList();
            this.renderPresets();
        }
    }

    async addPresetRepository(indexValue) {
        const index = Number.parseInt(String(indexValue), 10);
        const preset = PRECONFIGURED_SKILL_REPOSITORIES[index];
        if (!preset) {
            return;
        }
        if (this.input) {
            this.input.value = preset.url;
        }
        await this.addRepository();
    }

    async removeRepository(indexValue) {
        if (this.loadFailed) {
            this.setStatus('Fix the manifest file before editing it here.', 'error');
            return;
        }
        const index = Number.parseInt(String(indexValue), 10);
        if (!Number.isInteger(index) || index < 0 || index >= this.repositories.length) {
            return;
        }

        const previous = this.repositories;
        this.repositories = previous.filter((_, idx) => idx !== index);
        try {
            await this.writeManifest();
            this.setStatus('Repository removed.', 'info');
            this.renderList();
            this.renderPresets();
        } catch (error) {
            this.repositories = previous;
            this.setStatus(error?.message || 'Could not write skills manifest.', 'error');
            this.renderList();
            this.renderPresets();
        }
    }

    closeModal() {
        assistOS.UI.closeModal(this.element, {
            changed: this.changed,
            count: this.repositories.length
        });
    }
}
