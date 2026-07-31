import net from 'node:net';
import { spawn } from 'node:child_process';
import { resolveOpenCodeBin } from './opencode-runner.mjs';

function reservePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
    });
}

export async function startOpenCodeControlServer({ env = process.env } = {}) {
    const port = await reservePort();
    const child = spawn(resolveOpenCodeBin(env), [
        'serve', '--pure', '--hostname', '127.0.0.1', '--port', String(port),
    ], {
        env: { ...process.env, ...env, HOME: env.HOME || '/root', NO_COLOR: '1' },
        stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(stderr.trim() || 'OpenCode control server failed to start.');
        try {
            const response = await fetch(`${baseUrl}/provider/auth`, {
                signal: AbortSignal.timeout(1000),
            });
            if (response.ok) {
                let closePromise = null;
                return {
                    child,
                    baseUrl,
                    close() {
                        if (closePromise) return closePromise;
                        closePromise = new Promise((resolve) => {
                            if (child.exitCode !== null || child.signalCode) return resolve();
                            let settled = false;
                            const finish = () => {
                                if (settled) return;
                                settled = true;
                                clearTimeout(forceTimer);
                                clearTimeout(abandonTimer);
                                resolve();
                            };
                            const forceTimer = setTimeout(() => {
                                try { child.kill('SIGKILL'); } catch (_) { }
                            }, 2000);
                            const abandonTimer = setTimeout(() => {
                                child.stderr.destroy();
                                child.unref();
                                finish();
                            }, 4000);
                            child.once('close', () => {
                                finish();
                            });
                            try { child.kill('SIGTERM'); } catch (_) { finish(); }
                        });
                        return closePromise;
                    },
                };
            }
        } catch (_) { }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    child.kill('SIGTERM');
    throw new Error(`OpenCode control server timed out.${stderr.trim() ? ` ${stderr.trim()}` : ''}`);
}

export async function openCodeJson(server, pathname, options = {}) {
    const response = await fetch(`${server.baseUrl}${pathname}`, {
        ...options,
        signal: options.signal || AbortSignal.timeout(30000),
        headers: {
            accept: 'application/json',
            ...(options.body ? { 'content-type': 'application/json' } : {}),
            ...(options.headers || {}),
        },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.data?.message || payload?.message || `OpenCode control request failed (${response.status}).`);
    return payload;
}
