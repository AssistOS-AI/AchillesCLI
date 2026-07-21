import { setPermissionMode } from '../lib/achillesSettings.mjs';

export async function setPersistedBrokerPermissionMode({
    permissionControlClient,
    workingDir,
    mode,
} = {}) {
    if (!permissionControlClient) {
        throw new Error('Permission controls are unavailable in this session.');
    }

    const previousMode = (await permissionControlClient.getMode()).mode;
    const confirmedMode = (await permissionControlClient.setMode(mode)).mode;
    try {
        return setPermissionMode(workingDir, confirmedMode);
    } catch (error) {
        try {
            await permissionControlClient.setMode(previousMode);
        } catch {
            // Preserve the original settings error after a best-effort Broker rollback.
        }
        throw error;
    }
}
