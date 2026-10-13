import { setTimeout as delay } from 'node:timers/promises';
import { fail } from '../embeddings/config.mjs';

export function httpUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw fail('URL_INVALID', 'Expected an absolute HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw fail('URL_INVALID', 'Only HTTP(S) URLs without embedded credentials are supported');
  }
  return url;
}

export function endpoint(base, path, params = {}) {
  const url = new URL(path, httpUrl(base.endsWith('/') ? base : base + '/'));
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url;
}

// Rate limits are never retried: a 429 ends the request at once so the site is not pressed further.
export function createHttp(settings, fetcher = fetch, cancel = undefined) {
  // Feeds never follow redirects; reading a discussion page may (follow: true), since article URLs often move.
  return async function request(address, { headers = {}, json = true, conditional = false, follow = false } = {}) {
    const url = httpUrl(String(address));
    for (let attempt = 0; attempt < 3; attempt++) {
      cancel?.throwIfAborted();
      let response;
      try {
        const timeout = AbortSignal.timeout(settings.timeoutMs);
        response = await fetcher(url, {
          headers: { 'User-Agent': settings.userAgent, ...headers },
          signal: cancel ? AbortSignal.any([timeout, cancel]) : timeout, redirect: follow ? 'follow' : 'manual',
        });
        if (conditional && response.status === 304) return { unchanged: true };
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          const target = response.headers.get('location');
          throw fail('REDIRECTED', `${url.hostname}: HTTP ${response.status} redirect${target
            ? ` to ${new URL(target, url).href}; use that address` : ''}`, response.status);
        }
        if (response.status === 429) {
          await response.body?.cancel();
          throw fail('RATE_LIMITED', `${url.hostname}: HTTP 429 rate limited; not retried in this run`, 429);
        }
        if (response.status >= 500) {
          const retry = response.headers.get('retry-after');
          const seconds = retry && /^\d+$/.test(retry) ? Number(retry)
            : retry && Number.isFinite(Date.parse(retry)) ? Math.max(0, (Date.parse(retry) - Date.now()) / 1000) : 0;
          await response.body?.cancel();
          if (attempt < 2 && seconds <= 2) { await delay(Math.max(seconds * 1000, 200 * 2 ** attempt)); continue; }
          throw fail('PROVIDER_UNAVAILABLE',
            `${url.hostname}: HTTP ${response.status}; retry later${retry ? ' (Retry-After provided)' : ''}`, response.status);
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw fail('HTTP_ERROR', `${url.hostname}: HTTP ${response.status}; check the address and access`, response.status);
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body ?? []) {
          size += chunk.length;
          if (size > 5 * 1024 * 1024) throw fail('RESPONSE_TOO_LARGE', 'Provider response exceeds 5 MiB');
          chunks.push(chunk);
        }
        const text = Buffer.concat(chunks).toString('utf8');
        let body = text;
        if (json) {
          try { body = JSON.parse(text); } catch { throw fail('PROVIDER_INVALID', `${url.hostname}: expected JSON`); }
        }
        return { body, etag: response.headers.get('etag'), modified: response.headers.get('last-modified'),
          type: response.headers.get('content-type') ?? '', url: response.url || url.href };
      } catch (error) {
        // A stopped monitor is not a provider failure.
        if (cancel?.aborted) throw cancel.reason;
        if (typeof error.code === 'string' && !error.code.startsWith('ERR_')) throw error;
        throw fail('NETWORK_ERROR', `${url.hostname}: request failed or timed out`);
      }
    }
  };
}
