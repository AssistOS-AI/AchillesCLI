// Explorer toolbar button: opens the Promotion Scout web interface in Explorer's expanded modal.
const SCOUT_PAGE_PATH = '/promotionScout/web/';
const SCOUT_AGENT_REF = 'AchillesCLI/promotionScout';

export class ScoutToolButton {
    constructor(element, invalidate) {
        this.element = element;
        this.invalidate = invalidate;
        this.hostContext = {};
        this.invalidate();
    }

    beforeRender() {}

    afterRender() {
        this.button = this.element.querySelector('#scoutToolButton');
        this.iconImageEl = this.element.querySelector('.scout-tool-button-icon-image');
        this.labelEl = this.element.querySelector('.scout-tool-button-label');
        this.syncButtonMetadata();
        this.button?.addEventListener('click', this.openScout);
    }

    afterUnload() {
        this.button?.removeEventListener('click', this.openScout);
    }

    updateHostContext(context = {}) {
        this.hostContext = context;
        this.syncButtonMetadata();
    }

    hostText(name, attribute, fallback) {
        const value = this.hostContext?.[name];
        if (typeof value === 'string' && value.trim()) return value.trim();
        return this.element.getAttribute(attribute) || fallback;
    }

    syncButtonMetadata() {
        const label = this.hostText('pluginLabel', 'data-plugin-label', 'Scout');
        const tooltip = this.hostText('pluginTooltip', 'data-plugin-tooltip', label);
        const icon = this.hostText('pluginIcon', 'data-plugin-icon', '');
        if (this.labelEl) this.labelEl.textContent = label;
        if (this.iconImageEl && icon) this.iconImageEl.src = icon;
        if (this.button) {
            this.button.title = tooltip;
            this.button.setAttribute('aria-label', tooltip);
        }
    }

    openScout = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const descriptor = this.hostContext?.pluginToolbarModal;
        const openExpandedModal = globalThis.assistOS?.UI?.openExpandedModal;
        if (descriptor && typeof openExpandedModal === 'function') {
            void openExpandedModal({ ...descriptor, title: this.hostContext?.pluginLabel || descriptor.title });
            return;
        }
        // Without the host modal, Explorer's runtime loader waits for the agent and then opens its page.
        const parameters = new URLSearchParams({ agentRef: SCOUT_AGENT_REF, label: 'Scout', target: SCOUT_PAGE_PATH });
        window.open(`/explorer/index.html#agent-runtime-wait?${parameters}`, '_blank', 'noopener,noreferrer');
    };
}
