// Lists the discussions of Promotion Scout's Subtopic matches tab: each post with its comments, the subtopic it
// matched and the comments already stored for it, with the item and project needed to store a new comment.
const key = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const SHOW = ['matched', 'new', 'all'];
const POST_CHARS = 2000;
const COMMENT_CHARS = 800;
const shorten = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);

export function parseInput(text = '') {
  const value = String(text).trim();
  if (!value) return { show: 'matched', limit: 20, offset: 0 };
  if (!value.startsWith('{')) return { topic: value, show: 'matched', limit: 20, offset: 0 };
  let input;
  try { input = JSON.parse(value); } catch { throw new Error('Input must be a topic name or a JSON object.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Input must be a JSON object.');
  if (input.topic !== undefined && typeof input.topic !== 'string') throw new Error('topic must be a string.');
  const show = input.show ?? 'matched';
  if (!SHOW.includes(show)) throw new Error('show must be matched, new or all.');
  const limit = input.limit ?? 20;
  const offset = input.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 to 100.');
  if (!Number.isInteger(offset) || offset < 0) throw new Error('offset must be a non-negative integer.');
  return { topic: input.topic, show, limit, offset, format: input.format };
}

async function projectOf(client, name) {
  for (let offset = 0; ; offset += 500) {
    const page = await client.call('scout_agent_topics_list', { offset, limit: 500 });
    const found = (page?.items ?? []).find(topic => key(topic.label) === key(name));
    if (found) return found.project;
    if (!page?.items?.length || offset + 500 >= (page.total ?? 0)) throw new Error(`No active topic named "${name}".`);
  }
}

export function formatDiscussions(page, input) {
  const rows = page?.items ?? [];
  const label = { matched: 'matched', new: 'new matched', all: '' }[input.show];
  const total = page?.total ?? rows.length;
  if (!rows.length) return `No ${label ? `${label} ` : ''}discussions${input.offset ? ` from offset ${input.offset}` : ''}.`;
  const lines = [`${total} ${label ? `${label} ` : ''}discussion${total === 1 ? '' : 's'}; showing ${input.offset + 1}–${input.offset + rows.length}.`];
  rows.forEach((row, index) => {
    lines.push('', `[${input.offset + index + 1}] ${row.title || row.url}`);
    lines.push(`    item: ${row.id}`, `    project: ${row.project}`, `    topic: ${row.topic}`);
    lines.push(`    url: ${row.thread_url || row.url}${row.sites?.length ? ` (${row.sites.join(', ')})` : ''}`);
    if (row.winner) lines.push(`    subtopic: ${row.winner.text} (similarity ${row.winner.score.toFixed(3)})${row.new ? ' [new]' : ''}`);
    else lines.push('    subtopic: none passed');
    if (row.error) lines.push(`    error: ${row.error}`);
    lines.push(`    post: ${row.post ? shorten(row.post.replace(/\s+/g, ' ').trim(), POST_CHARS) : '(no text besides the title)'}`);
    const comments = row.comments ?? [];
    lines.push(comments.length ? `    comments (${comments.length}):` : '    comments: none');
    comments.forEach((comment, number) => lines.push(`      ${number + 1}. ${shorten(String(comment).replace(/\s+/g, ' ').trim(), COMMENT_CHARS)}`));
    const stored = row.generations ?? [];
    lines.push(stored.length ? `    stored comments (${stored.length}):` : '    stored comments: none');
    stored.forEach(generation => lines.push(`      - ${generation.agent}${generation.model ? `/${generation.model}` : ''} for "${generation.subtopic}": ${shorten(generation.comment.replace(/\s+/g, ' ').trim(), COMMENT_CHARS)}`));
  });
  if (input.offset + rows.length < total) lines.push('', `More: run again with {"offset": ${input.offset + rows.length}}.`);
  lines.push('', 'Store comments in one batch with the add-comments skill, passing the item and project shown above.');
  return lines.join('\n');
}

export async function action(text, client) {
  const input = parseInput(text);
  const project = input.topic === undefined ? undefined : await projectOf(client, input.topic);
  const page = await client.call('scout_agent_discussions_list',
    { ...(project ? { topic: project } : {}), show: input.show, offset: input.offset, limit: input.limit });
  return input.format === 'json' ? JSON.stringify(page, null, 2) : formatDiscussions(page, input);
}
