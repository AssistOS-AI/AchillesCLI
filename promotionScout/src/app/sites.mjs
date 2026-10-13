import { readFile } from 'node:fs/promises';
import { fail, hash } from '../embeddings/config.mjs';
import { httpUrl } from '../providers/http.mjs';
import { resolveFeed } from '../providers/feeds.mjs';
import { effectiveFields } from './derive.mjs';

export const siteKinds = Object.freeze({ search: '{query}', tag: '{tag}', feed: null });
export const tagStyles = ['joined', 'hyphen', 'underscore', 'alnum'];
const optionKeys = ['joinTerms', 'tagStyle', 'delayMs', 'remove'];

export async function loadSiteCatalog(path = new URL('../../config/sites.json', import.meta.url)) {
  const catalog = JSON.parse(await readFile(path, 'utf8'));
  return catalog.sites.map(site => ({ ...validateSite(site), id: site.id }));
}

// A template is an absolute HTTP(S) URL or an RSSHub route beginning with "/".
// Search templates contain {query}, tag templates {tag}, feed templates neither.
export function validateSite({ name, kind, template, ...options }) {
  if (typeof name !== 'string' || !name.trim() || name.length > 100) throw fail('INPUT_INVALID', 'Site name needs 1–100 characters');
  if (!Object.hasOwn(siteKinds, kind)) throw fail('INPUT_INVALID', 'Site kind must be search, tag or feed');
  if (typeof template !== 'string' || !template.trim() || template.length > 1000) {
    throw fail('INPUT_INVALID', 'Site address needs 1–1000 characters');
  }
  template = template.trim();
  const marker = siteKinds[kind];
  const markers = template.match(/\{(?:query|tag)\}/g) ?? [];
  if (marker ? markers.length !== 1 || markers[0] !== marker : markers.length) {
    throw fail('INPUT_INVALID', marker ? `A ${kind} site address must contain ${marker} exactly once`
      : 'A feed address must not contain {query} or {tag}');
  }
  const sample = template.replace(/\{(?:query|tag)\}/, 'sample');
  if (template.startsWith('/')) {
    if (template.startsWith('//') || template.includes('..')) throw fail('INPUT_INVALID', 'RSSHub routes look like /bsky/keyword/{query}');
  } else httpUrl(sample);
  const tagStyle = kind === 'tag' ? options.tagStyle ?? 'joined' : undefined;
  if (tagStyle !== undefined && !tagStyles.includes(tagStyle)) throw fail('INPUT_INVALID', `tagStyle must be ${tagStyles.join(', ')}`);
  for (const pattern of options.remove ?? []) new RegExp(pattern, 'gm');
  const clean = Object.fromEntries(optionKeys.map(key => [key, key === 'tagStyle' ? tagStyle : options[key]])
    .filter(([, value]) => value !== undefined));
  return { name: name.trim(), kind, template, options: clean };
}

export function normalizeTag(tag, style = 'joined') {
  const words = String(tag).normalize('NFKC').toLowerCase().trim().split(/[\s_-]+/)
    .map(word => word.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  if (style === 'hyphen') return words.join('-');
  if (style === 'underscore') return words.join('_');
  const joined = words.join('');
  return style === 'alnum' ? joined.replace(/[^a-z0-9]/g, '') : joined;
}

// Concrete feeds one site contributes for one topic.
export function siteSources(site, topic) {
  const options = typeof site.options === 'string' ? JSON.parse(site.options) : site.options ?? {};
  const make = value => {
    const filled = value === null ? site.template
      : site.template.replace(/\{(?:query|tag)\}/, encodeURIComponent(value));
    return filled.startsWith('/') ? { type: 'rsshub', locator: filled } : { type: 'rss', locator: filled };
  };
  if (site.kind === 'feed') return [make(null)];
  // Empty stored lists are derived from the description.
  const { searchTerms, tags } = effectiveFields(topic);
  if (site.kind === 'tag') return [...new Set(tags.map(tag => normalizeTag(tag, options.tagStyle)).filter(Boolean))].map(make);
  // Sites with an OR syntax receive one combined query per topic, which keeps request counts low.
  // Parentheses group the words of a term without demanding the exact phrase.
  if (options.joinTerms) return [make(searchTerms.map(term => /\s/.test(term) ? `(${term})` : term).join(options.joinTerms))];
  return searchTerms.map(make);
}

export function syncCatalog(store, catalog) {
  const ids = new Set(catalog.map(site => site.id));
  store.transaction(() => {
    for (const site of catalog) {
      store.db.prepare(`INSERT INTO sites(id,name,kind,template,options,builtin,enabled,created_at) VALUES(?,?,?,?,?,1,1,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, template=excluded.template,
        options=excluded.options, builtin=1`)
        .run(site.id, site.name, site.kind, site.template, JSON.stringify(site.options), new Date().toISOString());
    }
    for (const row of store.db.prepare('SELECT id FROM sites WHERE builtin=1').all()) {
      if (!ids.has(row.id)) store.db.prepare('DELETE FROM sites WHERE id=?').run(row.id);
    }
  });
}

// Feed sites given as a web page are resolved once to the advertised feed, so polls read only RSS/Atom.
export async function addSite(store, input, request) {
  // Manual sites may choose a tag style; spacing, OR-joining and text cleanup belong to the built-in catalog.
  const site = validateSite({ name: input.name, kind: input.kind, template: input.template, tagStyle: input.tagStyle });
  if (site.kind === 'feed' && !site.template.startsWith('/')) site.template = await resolveFeed(site.template, request);
  const id = `custom-${hash(`${site.kind}\n${site.template}`).slice(0, 12)}`;
  if (store.db.prepare('SELECT 1 FROM sites WHERE template=?').get(site.template)) {
    throw fail('SITE_EXISTS', 'A site with this address already exists');
  }
  store.db.prepare('INSERT INTO sites(id,name,kind,template,options,builtin,enabled,created_at) VALUES(?,?,?,?,?,0,1,?)')
    .run(id, site.name, site.kind, site.template, JSON.stringify(site.options), new Date().toISOString());
  return { id, ...site, builtin: false, enabled: true };
}

export function setSiteEnabled(store, id, enabled) {
  if (typeof enabled !== 'boolean') throw fail('INPUT_INVALID', 'Send {"enabled": true|false}');
  if (!store.db.prepare('UPDATE sites SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id).changes) {
    throw fail('SITE_UNKNOWN', `Unknown site: ${id}`);
  }
  return { id, enabled };
}

// Built-in sites can only be disabled; their entries and results stay stored either way.
export function deleteSite(store, id) {
  const site = store.db.prepare('SELECT builtin FROM sites WHERE id=?').get(id);
  if (!site) throw fail('SITE_UNKNOWN', `Unknown site: ${id}`);
  if (site.builtin) throw fail('SITE_BUILTIN', 'Built-in sites cannot be deleted; disable them instead');
  store.db.prepare('DELETE FROM sites WHERE id=?').run(id);
  return { id, deleted: true };
}

export function enabledSites(store) {
  return store.db.prepare('SELECT * FROM sites WHERE enabled=1 ORDER BY builtin DESC, name').all()
    .map(site => ({ ...site, options: JSON.parse(site.options) }));
}
