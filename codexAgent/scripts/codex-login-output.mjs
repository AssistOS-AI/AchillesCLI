const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;

export function stripAnsi(value) {
    return String(value || '').replace(ANSI_RE, '');
}

export function parseCodexDeviceLoginOutput(value) {
    const cleaned = stripAnsi(value);
    const url = cleaned.match(/https?:\/\/[^\s]+/)?.[0]?.replace(/[),.;]+$/, '') || '';
    const codeLabel = cleaned.match(/\bone-time\s+code\b/i);
    const codeTail = codeLabel ? cleaned.slice(codeLabel.index + codeLabel[0].length) : '';
    const code = codeTail.match(
        /^(?:[ \t]*\([^\r\n)]*\))?[ \t]*(?::[ \t]*|\r?\n[ \t]*)([A-Z0-9]{4,}(?:-[A-Z0-9]{4,})+)/i,
    )?.[1]?.toUpperCase() || '';
    return { cleaned, url, code };
}
