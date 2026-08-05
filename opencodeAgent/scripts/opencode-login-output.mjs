const ANSI_OSC_RE = /\u001b\][^\u0007]*(?:\u0007|\u001b\\|$)/g;
const ANSI_CSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_TWO_BYTE_RE = /\u001b[@-_]/g;

export function stripAnsi(value) {
    return String(value || '')
        .replace(ANSI_OSC_RE, '')
        .replace(ANSI_CSI_RE, '')
        .replace(ANSI_TWO_BYTE_RE, '')
        .replace(/[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

export function parseOpenCodeDeviceLoginOutput(value, expectedVerificationUri) {
    const cleaned = stripAnsi(value);
    let expected = '';
    try {
        const parsed = new URL(expectedVerificationUri);
        if (parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '') {
            expected = parsed.href;
        }
    } catch (_) { }
    const lineUrl = cleaned.match(/(?:^|\n)[^\r\n]{0,32}\bGo to:[ \t]*(https:\/\/[^\s]+)/u)?.[1] || '';
    let url = '';
    try {
        if (expected && new URL(lineUrl).href === expected) url = expectedVerificationUri;
    } catch (_) { }
    const code = url
        ? cleaned.match(/(?:^|\n)[^\r\n]{0,32}\bEnter code:[ \t]*([A-Z0-9]{4,12}(?:-[A-Z0-9]{4,12})*)\b/iu)?.[1]?.toUpperCase() || ''
        : '';
    return { cleaned, url, code };
}

export const __testables = Object.freeze({
    ANSI_CSI_RE,
    ANSI_OSC_RE,
    ANSI_TWO_BYTE_RE,
});
