import { randomUUID } from 'node:crypto';

import { createWebchatInteractionResolved } from '../permissions/protocol.mjs';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

function interactionId() {
    return `task_control_${randomUUID().replaceAll('-', '_')}`;
}

function publicChallenge(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.type === 'device_code') {
        return {
            type: 'device_code',
            verificationUri: String(raw.verificationUri || '').slice(0, 4000),
            userCode: String(raw.userCode || '').slice(0, 100),
            instructions: String(raw.instructions || '').slice(0, 2000),
            ...(Number.isFinite(Number(raw.expiresInSeconds)) ? { expiresInSeconds: Number(raw.expiresInSeconds) } : {}),
        };
    }
    if (raw.type === 'manual_oauth_code') {
        return {
            type: 'manual_oauth_code',
            url: String(raw.url || '').slice(0, 4000),
            instructions: String(raw.instructions || '').slice(0, 2000),
        };
    }
    return null;
}

export function createWebchatInteractionController({ stdout = process.stdout, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    let pending = null;

    function emit(value) {
        stdout.write(`${JSON.stringify(value)}\n`);
    }

    function closePending(status, error = null) {
        if (!pending) return;
        const current = pending;
        pending = null;
        clearTimeout(current.timer);
        current.signal?.removeEventListener?.('abort', current.abort);
        emit(createWebchatInteractionResolved({ id: current.id, status }));
        if (error) current.reject(error);
    }

    function request(envelope, { signal, values = null } = {}) {
        if (pending) return Promise.reject(new Error('another_interaction_is_pending'));
        if (signal?.aborted) return Promise.reject(new Error('interaction_cancelled'));
        const id = interactionId();
        return new Promise((resolve, reject) => {
            const abort = () => closePending('cancelled', new Error('interaction_cancelled'));
            const timer = setTimeout(() => closePending('expired', new Error('interaction_expired')), timeoutMs);
            timer.unref?.();
            pending = { id, resolve, reject, values, signal, abort, timer, input: envelope.input || null };
            signal?.addEventListener?.('abort', abort, { once: true });
            emit({
                __webchatInteraction: 1,
                version: 1,
                id,
                ...envelope,
            });
        });
    }

    function select({
        title,
        message = '',
        detail = '',
        options,
        searchable = false,
        targetTaskId = '',
        targetTabId = '',
        challenge = null,
    }, requestOptions = {}) {
        const normalizedChallenge = publicChallenge(challenge);
        const normalized = (Array.isArray(options) ? options : []).map((option, index) => ({
            id: `choice_${index}`,
            label: String(option?.label || option?.value || ''),
            description: String(option?.description || ''),
            value: option?.value,
            tone: option?.tone === 'danger' ? 'danger' : 'default',
        })).filter((option) => option.label && option.value !== undefined);
        if (!normalized.length) return Promise.reject(new Error('interaction_has_no_options'));
        return request({
            kind: 'select',
            title,
            message,
            detail,
            options: normalized.map(({ value: _value, ...option }) => option),
            defaultOptionId: normalized[0].id,
            searchable: searchable === true,
            ...(targetTaskId ? { targetTaskId } : {}),
            ...(targetTabId ? { targetTabId } : {}),
            ...(normalizedChallenge ? { challenge: normalizedChallenge } : {}),
        }, {
            ...requestOptions,
            values: new Map(normalized.map((option) => [option.id, option.value])),
        });
    }

    function input({
        title,
        message = '',
        detail = '',
        type = 'text',
        placeholder = '',
        maxLength = 4000,
        targetTaskId = '',
        targetTabId = '',
        challenge = null,
    }, requestOptions = {}) {
        const normalizedChallenge = publicChallenge(challenge);
        return request({
            kind: 'input',
            title,
            message,
            detail,
            options: [],
            input: {
                type: type === 'secret' ? 'secret' : 'text',
                placeholder: String(placeholder || ''),
                maxLength: Math.max(1, Math.min(Number(maxLength) || 4000, 65536)),
            },
            ...(targetTaskId ? { targetTaskId } : {}),
            ...(targetTabId ? { targetTabId } : {}),
            ...(normalizedChallenge ? { challenge: normalizedChallenge } : {}),
        }, requestOptions);
    }

    function resolve(response) {
        if (!pending || response?.id !== pending.id) return false;
        const current = pending;
        if (current.input) {
            if (typeof response.response !== 'string' || response.response.length > current.input.maxLength) return false;
            pending = null;
            clearTimeout(current.timer);
            current.signal?.removeEventListener?.('abort', current.abort);
            current.resolve(response.response);
            return true;
        }
        if (!current.values?.has(response?.optionId)) return false;
        pending = null;
        clearTimeout(current.timer);
        current.signal?.removeEventListener?.('abort', current.abort);
        current.resolve(current.values.get(response.optionId));
        return true;
    }

    function dispose() {
        closePending('cancelled', new Error('interaction_controller_closed'));
    }

    return {
        select,
        input,
        resolve,
        dispose,
        get pendingId() { return pending?.id || null; },
    };
}

export const __testables = { DEFAULT_TIMEOUT_MS };
