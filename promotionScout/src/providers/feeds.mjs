import { fail } from '../embeddings/config.mjs';
import { canonical } from '../app/normalize.mjs';

const many = value => value == null ? [] : Array.isArray(value) ? value : [value];
const scalar = value => typeof value === 'object' && value !== null ? value['#text'] ?? '' : value ?? '';
const feedRoot = /<(?:rss|feed|rdf:RDF)\b/i;

// Parses RSS 2.0, RSS 1.0 (RDF) and Atom into raw items with direct URLs.
export async function parseFeed(xml, base) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw fail('FEED_INVALID', 'DTD and entity declarations are not supported');
  let parser;
  try { parser = await import('fast-xml-parser'); }
  catch { throw fail('DEPENDENCY_MISSING', 'RSS/Atom requires fast-xml-parser 5.11.2; restart the agent so its install step prepares it'); }
  if (parser.XMLValidator.validate(xml) !== true) throw fail('FEED_INVALID', 'Malformed XML feed');
  const data = new parser.XMLParser({ ignoreAttributes: false, removeNSPrefix: true,
    parseTagValue: false, trimValues: true }).parse(xml);
  const atom = data.feed;
  const entries = atom ? atom.entry : data.rss?.channel ? data.rss.channel.item : data.RDF ? data.RDF.item : undefined;
  if (!atom && !data.rss?.channel && !data.RDF) throw fail('FEED_INVALID', 'Expected an RSS 2.0, RSS 1.0 or Atom feed');
  return many(entries).map(entry => {
    const link = atom ? many(entry.link).find(value => !value['@_rel'] || value['@_rel'] === 'alternate')?.['@_href']
      : scalar(entry.link) || entry['@_about'];
    if (!link) throw fail('FEED_INVALID', 'Feed entry has no direct URL');
    const url = new URL(link, base).href;
    const id = String(scalar(entry.id ?? entry.guid) || url);
    // Link aggregators point the entry link at the article; the discussion lives in <comments> or the guid.
    const discussion = [scalar(entry.comments), id].find(value => /^https?:\/\//i.test(String(value ?? '')));
    return { platform: new URL(url).hostname, external_id: id, url, discussion_url: discussion ?? url,
      title: scalar(entry.title),
      // Namespaced media elements (media:content, media:group) share local names with text fields,
      // so the first nonempty text candidate wins. YouTube keeps its description in media:group.
      text: [entry.encoded, entry.content, entry.description, entry.summary, entry.group?.description]
        .flatMap(many).map(scalar).find(value => typeof value === 'string' && value.trim()) ?? '',
      author: scalar(entry.author?.name ?? entry.author ?? entry.creator) || null,
      date: scalar(entry.published ?? entry.pubDate ?? entry.updated ?? entry.date) || null };
  });
}

export async function pollFeed(url, state, request) {
  const headers = {};
  if (state.etag) headers['If-None-Match'] = state.etag;
  if (state.modified) headers['If-Modified-Since'] = state.modified;
  const response = await request(url, { json: false, headers, conditional: true });
  if (response.unchanged) return { items: [], state };
  return { items: await parseFeed(response.body, url), state: { etag: response.etag, modified: response.modified } };
}

// Returns the feed URL for a feed address or for an HTML page advertising a same-origin RSS/Atom feed.
// The page text itself is never returned.
export async function resolveFeed(address, request) {
  const response = await request(address, { json: false });
  if (feedRoot.test(response.body.slice(0, 4096))) {
    await parseFeed(response.body, address);
    return canonical(address);
  }
  for (const tag of response.body.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)]
      .map(([, key, , value]) => [key.toLowerCase(), value]));
    if (!attrs.rel?.toLowerCase().split(/\s+/).includes('alternate')
        || !/application\/(?:rss|atom)\+xml/i.test(attrs.type ?? '') || !attrs.href) continue;
    const feed = canonical(new URL(attrs.href.replace(/&amp;/g, '&'), address).href);
    // Keep automatic feed detection on the page's origin.
    if (new URL(feed).origin !== new URL(address).origin) continue;
    const advertised = await request(feed, { json: false });
    await parseFeed(advertised.body, feed);
    return feed;
  }
  throw fail('FEED_NOT_FOUND', 'The address is not an RSS/Atom feed and advertises no same-origin feed');
}
