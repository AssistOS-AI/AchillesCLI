// Removes a Promotion Scout topic, or only some of its subtopics.
const key = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const PAGE = 500;

export function parseInput(text = '') {
  const value = String(text).trim();
  if (!value) throw new Error('Give the topic name, or JSON {"topic": "...", "subtopics": ["..."]}.');
  if (!value.startsWith('{')) return { topic: value };
  let input;
  try { input = JSON.parse(value); } catch { throw new Error('Input must be a topic name or a JSON object.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Input must be a JSON object.');
  const topic = typeof input.topic === 'string' ? input.topic.trim() : '';
  if (!topic) throw new Error('topic is required.');
  if (input.subtopics === undefined) return { topic };
  if (!Array.isArray(input.subtopics) || !input.subtopics.length
      || input.subtopics.some(entry => !(typeof entry === 'string' && entry.trim()) && !(Number.isInteger(entry) && entry > 0))) {
    throw new Error('subtopics must be a non-empty list of subtopic texts or ids.');
  }
  return { topic, subtopics: input.subtopics };
}

async function findTopic(client, name) {
  for (let offset = 0; ; offset += PAGE) {
    const page = await client.call('scout_agent_topics_list', { offset, limit: PAGE });
    const found = (page?.items ?? []).find(topic => key(topic.label) === key(name));
    if (found) return found;
    if (!page?.items?.length || offset + PAGE >= (page.total ?? 0)) return null;
  }
}

async function deleteSubtopics(client, input) {
  const topic = await findTopic(client, input.topic);
  if (!topic) throw new Error(`No active topic named "${input.topic}".`);
  const subtopics = topic.subtopics ?? [];
  // Resolve every requested subtopic before removing any, so a typo removes nothing.
  const targets = input.subtopics.map(entry => {
    const match = subtopics.find(subtopic => (Number.isInteger(entry) ? subtopic.id === entry : key(subtopic.text) === key(entry)));
    if (!match) {
      const known = subtopics.map(subtopic => `[${subtopic.id}] ${subtopic.text}`).join('; ') || 'none';
      throw new Error(`Topic "${topic.label}" has no subtopic ${JSON.stringify(entry)}. Its subtopics: ${known}.`);
    }
    return match;
  });
  const lines = [];
  for (const subtopic of new Map(targets.map(target => [target.id, target])).values()) {
    await client.call('scout_agent_subtopic_remove', { id: subtopic.id });
    lines.push(`Subtopic "${subtopic.text}" [${subtopic.id}] removed from "${topic.label}".`);
  }
  return lines.join('\n');
}

export async function action(text, client) {
  const input = parseInput(text);
  if (input.subtopics) return deleteSubtopics(client, input);
  const removed = await client.call('scout_agent_topic_delete', { key: input.topic });
  return `Topic "${removed.label}" ${removed.status}. Its history stays stored; adding it again restores it.`;
}
