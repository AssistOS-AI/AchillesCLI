// Lists the active Promotion Scout topics with their search terms, tags and subtopics.
const PAGE = 500;
const key = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

export function parseInput(text = '') {
  const value = String(text).trim();
  if (!value) return {};
  if (!value.startsWith('{')) return { topic: value };
  let input;
  try { input = JSON.parse(value); } catch { throw new Error('Input must be a topic name or a JSON object.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Input must be a JSON object.');
  if (input.topic !== undefined && typeof input.topic !== 'string') throw new Error('topic must be a string.');
  return input;
}

export async function listTopics(client) {
  const topics = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await client.call('scout_agent_topics_list', { offset, limit: PAGE });
    topics.push(...(page?.items ?? []));
    if (!page?.items?.length || offset + PAGE >= (page.total ?? 0)) return topics;
  }
}

export function formatTopics(topics) {
  if (!topics.length) return 'No active topics.';
  const lines = [`${topics.length} active topic${topics.length === 1 ? '' : 's'}:`];
  for (const topic of topics) {
    const fields = topic.effective ?? {};
    lines.push(`- ${topic.label}`);
    lines.push(`  search terms${fields.derivedTerms ? ' (derived)' : ''}: ${(fields.searchTerms ?? topic.search_terms ?? []).join(', ') || '-'}`);
    lines.push(`  tags${fields.derivedTags ? ' (derived)' : ''}: ${(fields.tags ?? topic.tags ?? []).join(', ') || '-'}`);
    const subtopics = topic.subtopics ?? [];
    lines.push(subtopics.length ? '  subtopics:' : '  subtopics: none');
    for (const subtopic of subtopics) lines.push(`    - [${subtopic.id}] ${subtopic.text}`);
  }
  return lines.join('\n');
}

export async function action(text, client) {
  const input = parseInput(text);
  let topics = await listTopics(client);
  if (input.topic !== undefined) {
    topics = topics.filter(topic => key(topic.label) === key(input.topic));
    if (!topics.length) return `No active topic named "${input.topic}".`;
  }
  return input.format === 'json' ? JSON.stringify(topics, null, 2) : formatTopics(topics);
}
