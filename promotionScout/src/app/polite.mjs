import { setTimeout as delay } from 'node:timers/promises';

export const politeDefaults = Object.freeze({ hostDelayMs: 1000, hostBackoffMs: 6 * 3600000 });
const refusals = [403, 429];

// Shared per-run request discipline for every host Scout reads: requests to one host are spaced, and a host
// that refuses with 403 or 429 is left alone for hours (the pause is stored, so it survives restarts).
export function createHostGate(store, { now = Date.now(), wait = delay, signal } = {}) {
  const blocked = new Set(), lastRequest = new Map();
  return {
    // Returns the pause end (ms) when the host must not be contacted now, otherwise null.
    pausedUntil(host) {
      const until = store.setting(`backoff:${host}`, 0);
      return blocked.has(host) || until > now ? until : null;
    },
    async before(host, delayMs = politeDefaults.hostDelayMs) {
      const gap = (lastRequest.get(host) ?? 0) + delayMs - Date.now();
      if (gap > 0) {
        try { await wait(gap, undefined, { signal }); } catch (error) { signal?.throwIfAborted(); throw error; }
      }
    },
    after(host) { lastRequest.set(host, Date.now()); },
    // Records a refusal; returns true when the status pauses the host.
    refused(host, status) {
      if (!refusals.includes(status)) return false;
      blocked.add(host);
      store.saveSetting(`backoff:${host}`, now + politeDefaults.hostBackoffMs);
      return true;
    },
  };
}
