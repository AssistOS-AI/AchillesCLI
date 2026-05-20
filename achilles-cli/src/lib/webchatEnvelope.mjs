const REFERENCE_SECRET_RE = /(^|\/)\.secrets$|\.secrets$/i;

export function normalizeWebchatReferences(rawReferences) {
    if (!Array.isArray(rawReferences)) return [];
    const out = [];
    const seen = new Set();
    for (const entry of rawReferences) {
        if (!entry || typeof entry !== 'object') continue;
        const kind = typeof entry.kind === 'string' ? entry.kind.trim() : '';
        const refPath = typeof entry.path === 'string' ? entry.path.trim() : '';
        if (!kind || !refPath) continue;
        if (refPath.includes('\0')) continue;
        if (kind === 'workspace-path') {
            const normalizedPath = refPath.replace(/\\+/g, '/');
            if (normalizedPath.startsWith('/')) continue;
            if (normalizedPath.split('/').some((segment) => segment === '..')) continue;
            if (REFERENCE_SECRET_RE.test(normalizedPath)) continue;
            const key = `${kind}:${normalizedPath}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                kind,
                path: normalizedPath,
                type: entry.type ? String(entry.type).trim() || null : null,
                label: entry.label ? String(entry.label).trim() || null : null,
            });
        }
    }
    return out;
}

export function normalizeWebchatMessage(raw) {
    const text = String(raw || '').trim();
    if (!text) {
        return { text: '', rawText: '', attachments: [], references: [], invocationToken: '' };
    }
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || !parsed.__webchatMessage) {
            return { text, rawText: text, attachments: [], references: [], invocationToken: '' };
        }
        const messageText = typeof parsed.text === 'string' ? parsed.text : '';
        const attachments = Array.isArray(parsed.attachments) ? parsed.attachments : [];
        const references = normalizeWebchatReferences(parsed.references);
        const invocationToken = typeof parsed.invocation?.token === 'string'
            ? parsed.invocation.token
            : '';
        const attachmentLines = attachments
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => {
                const name = entry.filename || entry.id || 'attachment';
                const localPath = entry.localPath ? ` path=${entry.localPath}` : '';
                const mime = entry.mime ? ` mime=${entry.mime}` : '';
                return `- ${name}${mime}${localPath}`;
            });
        const referenceLines = references.map((entry) => {
            const kind = entry.type || 'file';
            return `- ${entry.label || entry.path} (${kind} path=${entry.path})`;
        });
        const sections = [];
        if (attachmentLines.length) {
            sections.push(`Attachments:\n${attachmentLines.join('\n')}`);
        }
        if (referenceLines.length) {
            sections.push(`Referenced workspace paths:\n${referenceLines.join('\n')}`);
        }
        return {
            text: sections.length
                ? `${messageText}\n\n${sections.join('\n\n')}`
                : messageText,
            rawText: messageText,
            attachments,
            references,
            invocationToken,
        };
    } catch {
        return { text, rawText: text, attachments: [], references: [], invocationToken: '' };
    }
}
