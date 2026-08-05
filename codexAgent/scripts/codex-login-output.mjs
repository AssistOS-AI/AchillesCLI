const ANSI_OSC_RE = /\u001b\][^\u0007]*(?:\u0007|\u001b\\|$)/g;
const ANSI_CSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_TWO_BYTE_RE = /\u001b[@-_]/g;
const DEVICE_VERIFICATION_URL = 'https://auth.openai.com/codex/device';
const DEVICE_VERIFICATION_URL_RE = /(?:^|[\s([])https:\/\/auth\.openai\.com\/codex\/device(?=$|[\s)\],])/m;
const DEVICE_CODE_RE = /^[ \t]*(?:\([^\r\n)]*\)[ \t]*)?(?::[ \t]*|\r?\n[ \t]*)([A-Z0-9]{4,12}(?:-[A-Z0-9]{4,12})+)\b/i;

export function stripAnsi(value) {
    return String(value || '')
        .replace(ANSI_OSC_RE, '')
        .replace(ANSI_CSI_RE, '')
        .replace(ANSI_TWO_BYTE_RE, '')
        .replace(/[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

export function parseCodexDeviceLoginOutput(value) {
    const cleaned = stripAnsi(value);
    const url = DEVICE_VERIFICATION_URL_RE.test(cleaned) ? DEVICE_VERIFICATION_URL : '';
    const codeLabel = cleaned.match(/\bone-time\s+code\b/i);
    const codeTail = codeLabel ? cleaned.slice(codeLabel.index + codeLabel[0].length) : '';
    const code = codeTail.match(DEVICE_CODE_RE)?.[1]?.toUpperCase() || '';
    return { cleaned, url, code };
}

export const __testables = Object.freeze({
    ANSI_CSI_RE,
    ANSI_OSC_RE,
    ANSI_TWO_BYTE_RE,
    DEVICE_CODE_RE,
    DEVICE_VERIFICATION_URL,
    DEVICE_VERIFICATION_URL_RE,
});
