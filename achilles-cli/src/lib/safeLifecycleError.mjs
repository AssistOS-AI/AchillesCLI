export const SAFE_LIFECYCLE_CODES = Object.freeze([
    'PLOINKY_BOX_MARKER_INVALID',
    'PLOINKY_BOX_RUNTIME_CAPABILITY_UNSUPPORTED',
    'PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE',
    'PLOINKY_WORKDIR_REQUIRED',
    'PLOINKY_WORKDIR_INVALID',
    'PLOINKY_WORKDIR_ROOT_FORBIDDEN',
    'PLOINKY_PATHFD_UNAVAILABLE',
    'PLOINKY_PROVIDER_HOME_BUSY',
    'PLOINKY_HOME_STATE_INCOMPATIBLE',
    'PLOINKY_AGENT_CREDENTIAL_CONTEXT_REQUIRED',
    'PLOINKY_AGENT_CREDENTIAL_RUNTIME_INVALID',
    'PLOINKY_PROVIDER_PROCESS_IDENTITY_UNVERIFIED',
    'PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID',
    'PLOINKY_PROVIDER_HELPER_TRANSPORT_INVALID',
    'PLOINKY_PROVIDER_PREEXEC_BARRIER_FAILED',
    'PLOINKY_PROVIDER_RUNTIME_TERMINATION_UNPROVEN',
    'PLOINKY_PROVIDER_TERMINATION_UNPROVEN',
    'PLOINKY_PROVIDER_TERMINAL_CLEANUP_FAILED',
    'PLOINKY_MANIFEST_SECURITY_INVALID',
    'PLOINKY_MANIFEST_SECURITY_PROFILE_UNSUPPORTED',
    'PLOINKY_OPEN_INTERPRETER_BOX_UNAVAILABLE',
    'PLOINKY_RUNTIME_INPUT_CHANGED',
]);
const safeLifecycleCodeSet = new Set(SAFE_LIFECYCLE_CODES);

const SAFE_MESSAGES = Object.freeze({
    PLOINKY_BOX_MARKER_INVALID: 'The Box runtime identity could not be verified.',
    PLOINKY_BOX_RUNTIME_CAPABILITY_UNSUPPORTED: 'The Box runtime does not support the required capability.',
    PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE: 'The delegated task sandbox capability is unavailable.',
    PLOINKY_WORKDIR_REQUIRED: 'A non-root project directory is required.',
    PLOINKY_WORKDIR_INVALID: 'The project directory is invalid or outside the admitted workspace.',
    PLOINKY_WORKDIR_ROOT_FORBIDDEN: 'The workspace root cannot be selected writable.',
    PLOINKY_PATHFD_UNAVAILABLE: 'Secure project directory resolution is unavailable.',
    PLOINKY_PROVIDER_HOME_BUSY: 'The coding agent home is already in use.',
    PLOINKY_HOME_STATE_INCOMPATIBLE: 'The coding agent home is incompatible with the selected runtime.',
    PLOINKY_AGENT_CREDENTIAL_CONTEXT_REQUIRED: 'The trusted agent credential context is unavailable.',
    PLOINKY_AGENT_CREDENTIAL_RUNTIME_INVALID: 'The selected runtime credential transport is invalid.',
    PLOINKY_PROVIDER_PROCESS_IDENTITY_UNVERIFIED: 'Provider process ownership could not be verified.',
    PLOINKY_PROVIDER_RUNTIME_BOUNDARY_INVALID: 'The canonical provider sandbox boundary could not be verified.',
    PLOINKY_PROVIDER_HELPER_TRANSPORT_INVALID: 'The provider sandbox helper transport is unavailable.',
    PLOINKY_PROVIDER_PREEXEC_BARRIER_FAILED: 'The provider sandbox could not complete secure startup.',
    PLOINKY_PROVIDER_RUNTIME_TERMINATION_UNPROVEN: 'Provider runtime cleanup could not be proven.',
    PLOINKY_PROVIDER_TERMINATION_UNPROVEN: 'Provider process cleanup could not be proven.',
    PLOINKY_PROVIDER_TERMINAL_CLEANUP_FAILED: 'Provider terminal resource cleanup failed.',
    PLOINKY_MANIFEST_SECURITY_INVALID: 'The agent manifest security declaration is invalid.',
    PLOINKY_MANIFEST_SECURITY_PROFILE_UNSUPPORTED: 'The agent security profile is unsupported.',
    PLOINKY_OPEN_INTERPRETER_BOX_UNAVAILABLE: 'Open Interpreter is unavailable in this Box runtime.',
    PLOINKY_RUNTIME_INPUT_CHANGED: 'The admitted runtime input changed before activation.',
});

function candidateCodes(value) {
    if (!value || typeof value !== 'object') return [];
    const pending = [value];
    const seen = new Set();
    const codes = [];
    while (pending.length && seen.size < 16) {
        const candidate = pending.shift();
        if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) continue;
        seen.add(candidate);
        codes.push(candidate.code, candidate.errorCode);
        for (const nested of [candidate.error, candidate.cause, candidate.result, candidate.task]) {
            if (nested && typeof nested === 'object') pending.push(nested);
        }
    }
    return codes;
}

export function safeLifecycleCode(value) {
    for (const candidate of candidateCodes(value)) {
        const code = typeof candidate === 'string' ? candidate.trim() : '';
        if (safeLifecycleCodeSet.has(code)) return code;
    }
    return '';
}

export function formatSafeLifecycleError(value) {
    const code = safeLifecycleCode(value);
    return code ? `${code}: ${SAFE_MESSAGES[code]}` : '';
}
