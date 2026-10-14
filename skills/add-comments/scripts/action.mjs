// Stores comments for Promotion Scout discussions as one batch; the Subtopic matches tab shows them with the discussion.
const FIELDS = ['item', 'project', 'comment', 'subtopic', 'agent', 'model'];
const LIMIT = 100;

function entry(value, index) {
  const where = ` (comments[${index}])`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Each comment must be a JSON object${where}.`);
  const unknown = Object.keys(value).filter(name => !FIELDS.includes(name));
  if (unknown.length) throw new Error(`Unknown field${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}${where}.`);
  for (const name of ['item', 'project', 'comment']) {
    if (typeof value[name] !== 'string' || !value[name].trim()) throw new Error(`${name} is required${where}.`);
  }
  for (const name of ['subtopic', 'agent', 'model']) {
    if (value[name] !== undefined && typeof value[name] !== 'string') throw new Error(`${name} must be a string${where}.`);
  }
  return Object.fromEntries(FIELDS.filter(name => value[name]?.trim()).map(name => [name, value[name]]));
}

// {"agent", "model", "comments": [...]}; a single comment object is accepted as a batch of one.
export function parseInput(text = '') {
  let input;
  try { input = JSON.parse(String(text).trim()); }
  catch { throw new Error('Input must be JSON: {"comments": [{"item", "project", "comment"}, ...]}.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Input must be a JSON object.');
  if (input.comments === undefined) return { comments: [entry(input, 0)] };
  const unknown = Object.keys(input).filter(name => !['comments', 'agent', 'model'].includes(name));
  if (unknown.length) throw new Error(`Unknown field${unknown.length === 1 ? '' : 's'} ${unknown.join(', ')}.`);
  if (!Array.isArray(input.comments) || !input.comments.length || input.comments.length > LIMIT) {
    throw new Error(`comments must be a list of 1–${LIMIT} comments; split larger batches.`);
  }
  const batch = { comments: input.comments.map(entry) };
  for (const name of ['agent', 'model']) {
    if (input[name] === undefined) continue;
    if (typeof input[name] !== 'string') throw new Error(`${name} must be a string.`);
    if (input[name].trim()) batch[name] = input[name];
  }
  return batch;
}

export async function action(text, client) {
  const batch = parseInput(text);
  let result;
  try { result = await client.call('scout_agent_comments_add', batch); }
  catch (error) {
    throw Object.assign(new Error(`No comment was stored: ${error.message}`), { code: error.code });
  }
  const lines = [`Stored ${result.count} comment${result.count === 1 ? '' : 's'}:`];
  for (const comment of result.comments) {
    lines.push(`- [${comment.id}] item ${comment.item} (topic "${comment.topic}", subtopic "${comment.subtopic}", by ${comment.agent}${comment.model ? `/${comment.model}` : ''})`);
  }
  return lines.join('\n');
}
