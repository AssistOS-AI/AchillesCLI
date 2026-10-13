import { hash, fail } from '../embeddings/config.mjs';
import { httpUrl } from '../providers/http.mjs';

export function plain(value = '') {
  return String(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ')
    .replace(/&#(?:x([0-9a-f]{1,6})|(\d{1,7}));/gi, (token, hex, decimal) => {
      const code = hex ? Number.parseInt(hex, 16) : Number(decimal);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    })
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, token => ({
      '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ',
    })[token]).replace(/\s+/g, ' ').trim();
}

export function canonical(value) {
  const url = httpUrl(value);
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/.test(key)) url.searchParams.delete(key);
  // Preserve fragments and comment parameters: they can identify different replies.
  return url.href;
}

export function normalizeItem(raw, source) {
  const url = canonical(raw.url);
  const title = plain(raw.title), text = plain(raw.text);
  if (!title && !text) throw fail('ITEM_INVALID', 'An item requires title or text');
  const platform = raw.platform ?? source.type;
  const kind = raw.kind ?? 'post';
  const externalId = String(raw.external_id ?? url);
  const id = hash(JSON.stringify([platform, kind, externalId]));
  const date = raw.date && Number.isFinite(Date.parse(raw.date)) ? new Date(raw.date).toISOString() : null;
  const author = raw.author == null ? null : String(raw.author);
  const contentHash = hash(JSON.stringify([title, text, url, author, date, raw.thread_id ?? null, raw.parent_id ?? null]));
  return { id, platform, kind, external_id: externalId, title, text, url, author, date,
    thread_id: raw.thread_id == null ? null : String(raw.thread_id),
    parent_id: raw.parent_id == null ? null : String(raw.parent_id), content_hash: contentHash,
    raw_json: JSON.stringify(raw), fetched_at: new Date().toISOString(), language: raw.language ?? '' };
}
