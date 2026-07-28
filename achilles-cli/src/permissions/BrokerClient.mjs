import net from 'node:net';

const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_INTERACTIVE_TIMEOUT_MS = 15 * 60 * 1000;

export class BrokerClient {
    #controlToken;

    constructor({
        socketPath = process.env.ACHILLES_BROKER_SOCKET,
        timeoutMs = DEFAULT_TIMEOUT_MS,
        controlToken = null,
    } = {}) {
        this.socketPath = socketPath;
        this.timeoutMs = timeoutMs;
        this.#controlToken = controlToken;
    }

    get available() {
        return Boolean(this.socketPath);
    }

    async request(type, payload = {}, { timeoutMs = this.timeoutMs } = {}) {
        if (!this.socketPath) {
            throw new Error('Achilles Broker is unavailable. Bash authorization is denied.');
        }
        return new Promise((resolve, reject) => {
            const socket = net.createConnection(this.socketPath);
            let responseBuffer = '';
            let settled = false;
            const finish = (error, result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                socket.destroy();
                if (error) reject(error);
                else resolve(result);
            };
            const timer = setTimeout(() => {
                finish(new Error(`Achilles Broker request timed out after ${timeoutMs}ms.`));
            }, timeoutMs);

            socket.setEncoding('utf8');
            socket.once('connect', () => {
                socket.end(`${JSON.stringify({ type, ...payload })}\n`);
            });
            socket.on('data', (chunk) => {
                responseBuffer += chunk;
            });
            socket.once('end', () => {
                try {
                    const response = JSON.parse(responseBuffer.trim());
                    if (response?.ok === false) {
                        finish(new Error(response.error || 'Achilles Broker rejected the request.'));
                        return;
                    }
                    finish(null, response);
                } catch (error) {
                    finish(new Error(`Invalid Achilles Broker response: ${error.message}`));
                }
            });
            socket.once('error', (error) => finish(error));
        });
    }

    getMode() {
        return this.request('permissions.get');
    }

    setMode(mode) {
        return this.request('permissions.set', { mode, controlToken: this.#controlToken });
    }

    authorize(toolName, params) {
        return this.request(
            'bash.authorize',
            { toolName, params },
            { timeoutMs: Math.max(this.timeoutMs, DEFAULT_INTERACTIVE_TIMEOUT_MS) },
        );
    }

    getPendingApproval() {
        return this.request('approval.pending');
    }

    async resolvePendingApproval(decision, interactionId = null) {
        const response = await this.request('approval.resolve', {
            decision,
            interactionId,
            controlToken: this.#controlToken,
        });
        return response;
    }
}
