import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const ALLOWED_MODELS = new Set(['fast', 'plan', 'deep']);

function generatedSource(env, name) {
    return String(env[`PLOINKY_ENV_SOURCE_${name}`] || '').trim() === 'generated';
}

function managedRouter(env) {
    const names = [
        'PLOINKY_AGENT_API_KEY',
        'PLOINKY_ROUTER_URL',
        'PLOINKY_ROUTER_REQUEST_AUTHORITY',
    ];
    const generated = names.map((name) => generatedSource(env, name));
    if (!generated.some(Boolean)) return null;
    if (!generated.every(Boolean)) {
        throw new Error(
            'Scoped Soul routing requires generated provenance for Router URL, request authority, and agent API key'
        );
    }

    const apiKey = String(env.PLOINKY_AGENT_API_KEY || '').trim();
    const authority = String(env.PLOINKY_ROUTER_REQUEST_AUTHORITY || '').trim();
    if (!apiKey || !authority) {
        throw new Error(
            'Scoped Soul routing requires PLOINKY_ROUTER_REQUEST_AUTHORITY and PLOINKY_AGENT_API_KEY'
        );
    }

    let upstream;
    try {
        upstream = new URL(String(env.PLOINKY_ROUTER_URL || '').trim());
        if (!['http:', 'https:'].includes(upstream.protocol)
            || upstream.username || upstream.password
            || upstream.search || upstream.hash) {
            throw new Error('unsupported Router URL');
        }
        upstream.pathname = '/base-agent-additional-server/soul-gateway/7000/v1/chat/completions';
    } catch (cause) {
        throw new Error('PLOINKY_ROUTER_URL is not a valid managed Router URL', { cause });
    }

    try {
        if (/[\u0000-\u0020\u007f/?#@]/u.test(authority)) {
            throw new Error('unsupported Router request authority');
        }
        const parsed = new URL(`http://${authority}`);
        if (!parsed.hostname || parsed.host !== authority
            || parsed.username || parsed.password || parsed.pathname !== '/') {
            throw new Error('unsupported Router request authority');
        }
    } catch (cause) {
        throw new Error(
            'PLOINKY_ROUTER_REQUEST_AUTHORITY is not a valid managed Router authority',
            { cause }
        );
    }

    return { apiKey, authority, upstream };
}

function jsonError(response, status, message) {
    if (response.headersSent) {
        response.destroy();
        return;
    }
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message } }));
}

function readBoundedBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let bytes = 0;
        request.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > MAX_REQUEST_BYTES) {
                reject(Object.assign(new Error('request body is too large'), { status: 413 }));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => resolve(Buffer.concat(chunks)));
        request.on('error', reject);
    });
}

function forward({ body, managed, response }) {
    const transport = managed.upstream.protocol === 'https:' ? https : http;
    const upstreamRequest = transport.request(managed.upstream, {
        method: 'POST',
        headers: {
            host: managed.authority,
            authorization: `Bearer ${managed.apiKey}`,
            'content-type': 'application/json',
            accept: 'text/event-stream, application/json',
            'content-length': body.length,
        },
    }, (upstreamResponse) => {
        const headers = {};
        for (const name of ['content-type', 'cache-control']) {
            const value = upstreamResponse.headers[name];
            if (value != null) headers[name] = value;
        }
        response.writeHead(upstreamResponse.statusCode || 502, headers);
        upstreamResponse.pipe(response);
    });
    response.once('close', () => upstreamRequest.destroy());
    upstreamRequest.on('error', () => {
        jsonError(response, 502, 'Soul Gateway request failed');
    });
    upstreamRequest.end(body);
}

export async function startScopedSoulBroker(env = process.env) {
    const managed = managedRouter(env);
    if (!managed) return null;
    const token = randomBytes(32).toString('base64url');
    const server = http.createServer(async (request, response) => {
        try {
            if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
                jsonError(response, 404, 'not found');
                return;
            }
            if (request.headers.authorization !== `Bearer ${token}`) {
                jsonError(response, 401, 'invalid broker credential');
                return;
            }
            const body = await readBoundedBody(request);
            let payload;
            try {
                payload = JSON.parse(body.toString('utf8'));
            } catch {
                jsonError(response, 400, 'request body must be JSON');
                return;
            }
            if (!payload || typeof payload !== 'object'
                || !ALLOWED_MODELS.has(payload.model)) {
                jsonError(response, 400, 'model must be fast, plan, or deep');
                return;
            }
            forward({ body, managed, response });
        } catch (error) {
            jsonError(response, error?.status || 500, 'broker request failed');
        }
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    return Object.freeze({
        environment: Object.freeze({
            PLOINKY_TASK_BROKER_URL: `http://127.0.0.1:${address.port}/v1`,
            PLOINKY_TASK_BROKER_KEY: token,
        }),
        async close() {
            await new Promise((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
                server.closeAllConnections();
            });
        },
    });
}

export const __testables = { managedRouter };
