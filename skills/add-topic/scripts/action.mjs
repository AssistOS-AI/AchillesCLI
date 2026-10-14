// Adds a Promotion Scout topic with optional subtopics, or adds subtopics to an existing topic.
const strings = (value, name) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) throw new Error(`${name} must be a list of strings.`);
  return value.map(entry => entry.trim()).filter(Boolean);
};

export function parseInput(text = '') {
  const value = String(text).trim();
  if (!value) throw new Error('Give the topic name, or JSON {"topic": "...", "subtopics": ["..."]}.');
  if (!value.startsWith('{')) return { topic: value, subtopics: [] };
  let input;
  try { input = JSON.parse(value); } catch { throw new Error('Input must be a topic name or a JSON object.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Input must be a JSON object.');
  const topic = typeof input.topic === 'string' ? input.topic.trim() : '';
  if (!topic) throw new Error('topic is required.');
  return { topic, subtopics: strings(input.subtopics, 'subtopics') ?? [],
    searchTerms: strings(input.searchTerms, 'searchTerms'), tags: strings(input.tags, 'tags') };
}

export async function action(text, client) {
  const input = parseInput(text);
  const fields = Object.fromEntries(Object.entries({ searchTerms: input.searchTerms, tags: input.tags })
    .filter(([, value]) => value?.length));
  const created = await client.call('scout_agent_topic_create', { label: input.topic, ...fields });
  const lines = [`Topic "${created.label}": ${created.status}.`];
  if (created.status === 'already exists' && Object.keys(fields).length) {
    lines.push('Search terms and tags of an existing topic were left unchanged.');
  }
  for (const [index, subtopic] of input.subtopics.entries()) {
    try {
      const added = await client.call('scout_agent_subtopic_add', { topic: created.label, text: subtopic });
      lines.push(`Subtopic "${added.text}": ${added.status}${added.id ? ` [${added.id}]` : ''}.`);
    } catch (error) {
      const remaining = input.subtopics.slice(index);
      throw new Error(`${lines.join('\n')}\nSubtopic "${subtopic}" failed: ${error.message}\nNot added: ${remaining.map(item => `"${item}"`).join(', ')}.`);
    }
  }
  return lines.join('\n');
}
