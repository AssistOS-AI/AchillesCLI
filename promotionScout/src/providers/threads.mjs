import { fail } from '../embeddings/config.mjs';
import { plain } from '../app/normalize.mjs';
import { parseFeed } from './feeds.mjs';

// Reads one discussion: the post and its first top-level comments, in the order the site shows them.
// Sites with a public structured source (JSON API or per-discussion feed) use it; other pages fall back to the
// readable text of their HTML. Each adapter returns { source, title, post, comments }.

export const threadDefaults = Object.freeze({ comments: 10, maxPostChars: 8000, maxCommentChars: 2000 });

const clip = (text, max) => text.length > max ? `${text.slice(0, max)}…` : text;
const texts = (values, n) => values.map(value => clip(plain(value), threadDefaults.maxCommentChars)).filter(Boolean).slice(0, n);
const json = async (request, url) => (await request(url, { json: true, follow: true })).body;

const adapters = [
  {
    // Hacker News items through the public Algolia API; children keep the site's ranking order.
    source: 'hacker-news', match: url => url.hostname === 'news.ycombinator.com' && url.searchParams.get('id'),
    async read(url, request, n) {
      const item = await json(request, `https://hn.algolia.com/api/v1/items/${encodeURIComponent(url.searchParams.get('id'))}`);
      return { title: item.title ?? '', post: item.text ?? '', comments: texts((item.children ?? []).map(child => child.text ?? ''), n) };
    },
  },
  {
    source: 'lobsters', match: url => url.hostname === 'lobste.rs' && url.pathname.match(/^\/s\/([a-z0-9]+)/)?.[1],
    async read(url, request, n, id) {
      const story = await json(request, `https://lobste.rs/s/${id}.json`);
      const top = (story.comments ?? []).filter(comment => comment.depth === 0);
      return { title: story.title ?? '', post: story.description_plain ?? story.description ?? '',
        comments: texts(top.map(comment => comment.comment_plain ?? comment.comment ?? ''), n) };
    },
  },
  {
    // Reddit's JSON view of a thread: depth=1 keeps only top-level comments, sort=top matches the default view.
    source: 'reddit', match: url => /(^|\.)reddit\.com$/.test(url.hostname) && url.pathname.match(/^\/r\/[^/]+\/comments\/([a-z0-9]+)/i)?.[1],
    async read(url, request, n, id) {
      const [listing, replies] = await json(request, `https://www.reddit.com/comments/${id}.json?depth=1&limit=${n}&sort=top&raw_json=1`);
      const post = listing?.data?.children?.[0]?.data ?? {};
      const top = (replies?.data?.children ?? []).filter(child => child.kind === 't1').map(child => child.data.body ?? '');
      return { title: post.title ?? '', post: post.selftext ?? '', comments: texts(top, n) };
    },
  },
  {
    // Stack Exchange question feeds list the question first, then its answers by votes.
    source: 'stack-exchange',
    match: url => /(^|\.)(stackoverflow\.com|stackexchange\.com|superuser\.com|serverfault\.com|askubuntu\.com|mathoverflow\.net)$/
      .test(url.hostname) && url.pathname.match(/^\/(?:questions|q)\/(\d+)/)?.[1],
    async read(url, request, n, id) {
      const feedUrl = `${url.origin}/feeds/question/${id}`;
      const [question, ...answers] = await parseFeed((await request(feedUrl, { json: false, follow: true })).body, feedUrl);
      return { title: question?.title ?? '', post: question?.text ?? '', comments: texts(answers.map(answer => answer.text), n) };
    },
  },
  {
    // Lemmy instances expose posts and top-level comments through their public API.
    source: 'lemmy', byShape: true, match: url => url.pathname.match(/^\/post\/(\d+)$/)?.[1],
    async read(url, request, n, id) {
      const { post_view: view } = await json(request, `${url.origin}/api/v3/post?id=${id}`);
      const list = await json(request, `${url.origin}/api/v3/comment/list?post_id=${id}&sort=Top&max_depth=1&limit=${n}&type_=All`);
      return { title: view?.post?.name ?? '', post: view?.post?.body ?? '',
        comments: texts((list.comments ?? []).map(entry => entry.comment?.content ?? ''), n) };
    },
  },
  {
    // Mastodon-compatible servers: the status and the replies that answer it directly.
    source: 'mastodon', byShape: true, match: url => url.pathname.match(/^\/@[^/]+\/(\d+)$/)?.[1],
    async read(url, request, n, id) {
      const status = await json(request, `${url.origin}/api/v1/statuses/${id}`);
      const context = await json(request, `${url.origin}/api/v1/statuses/${id}/context`);
      const direct = (context.descendants ?? []).filter(reply => reply.in_reply_to_id === id).map(reply => reply.content ?? '');
      return { title: '', post: status.content ?? '', comments: texts(direct, n) };
    },
  },
  {
    // Bluesky through the public AppView: resolve the handle, then read the thread one level deep.
    source: 'bluesky', match: url => url.hostname === 'bsky.app' && url.pathname.match(/^\/profile\/([^/]+)\/post\/([a-z0-9]+)$/i),
    async read(url, request, n, [, handle, rkey]) {
      const api = 'https://public.api.bsky.app/xrpc';
      const did = handle.startsWith('did:') ? handle
        : (await json(request, `${api}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`)).did;
      const { thread } = await json(request, `${api}/app.bsky.feed.getPostThread?depth=1&uri=${encodeURIComponent(`at://${did}/app.bsky.feed.post/${rkey}`)}`);
      return { title: '', post: thread?.post?.record?.text ?? '',
        comments: texts((thread?.replies ?? []).map(reply => reply?.post?.record?.text ?? ''), n) };
    },
  },
  {
    source: 'dev', match: url => url.hostname === 'dev.to' && url.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/),
    async read(url, request, n, [, user, slug]) {
      const article = await json(request, `https://dev.to/api/articles/${encodeURIComponent(user)}/${encodeURIComponent(slug)}`);
      const comments = await json(request, `https://dev.to/api/comments?a_id=${article.id}`);
      return { title: article.title ?? '', post: article.body_html ?? article.description ?? '',
        comments: texts(comments.map(comment => comment.body_html ?? ''), n) };
    },
  },
  {
    // Discourse forums: the topic JSON lists the opening post first, then replies in order.
    source: 'discourse', byShape: true, match: url => url.pathname.match(/^\/t\/[^/]+\/(\d+)/)?.[1],
    async read(url, request, n, id) {
      const topic = await json(request, `${url.origin}/t/${id}.json`);
      const [first, ...replies] = topic.post_stream?.posts ?? [];
      return { title: topic.title ?? '', post: first?.cooked ?? '', comments: texts(replies.map(reply => reply.cooked ?? ''), n) };
    },
  },
];

// Readable text of an HTML page: scripts, styles and page chrome are removed, and the article or main element is
// preferred. Comments cannot be told apart generically, so they stay inside the page text.
export function pageText(html) {
  const meta = name => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)`, 'i'))?.[1] ?? '';
  const stripped = html.replace(/<(script|style|svg|nav|header|footer|aside|form|template)\b[\s\S]*?<\/\1>/gi, ' ');
  const region = stripped.match(/<article\b[\s\S]*<\/article>/i)?.[0] ?? stripped.match(/<main\b[\s\S]*<\/main>/i)?.[0]
    ?? stripped.match(/<body\b[\s\S]*<\/body>/i)?.[0] ?? stripped;
  const text = plain(region);
  const title = plain(meta('og:title') || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  // Pages rendered by JavaScript carry little body text; their description is then the best available summary.
  return { title, post: text.length >= 200 ? text : [plain(meta('og:description') || meta('description')), text].filter(Boolean).join(' ') };
}

export async function fetchThread(address, request, { comments = threadDefaults.comments } = {}) {
  const url = new URL(address);
  for (const adapter of adapters) {
    const matched = adapter.match(url);
    if (!matched) continue;
    try { return finish(adapter.source, await adapter.read(url, request, comments, matched)); }
    catch (error) {
      // Adapters recognized only by URL shape may meet another kind of site; read its page instead, unless the
      // host refused us, which must not be pressed with another request.
      if (!adapter.byShape || [403, 429].includes(error.status) || error.code === 'ABORTED') throw error;
    }
    break;
  }
  const response = await request(url.href, { json: false, follow: true });
  if (!/html/i.test(response.type ?? 'text/html')) throw fail('THREAD_UNSUPPORTED', `${url.hostname}: not an HTML page (${response.type})`);
  return finish('page', { ...pageText(response.body), comments: [] });
}

function finish(source, { title, post, comments }) {
  const result = { source, title: plain(title), post: clip(plain(post), threadDefaults.maxPostChars), comments };
  if (!result.title && !result.post && !comments.length) throw fail('THREAD_EMPTY', 'The discussion page contains no readable text');
  return result;
}

// The hosts an adapter contacts, so the per-host gate can space and pause them.
export function threadHosts(address) {
  const url = new URL(address);
  const source = adapters.find(adapter => adapter.match(url))?.source;
  return { 'hacker-news': ['hn.algolia.com'], reddit: ['www.reddit.com'], bluesky: ['public.api.bsky.app'] }[source] ?? [url.host];
}
