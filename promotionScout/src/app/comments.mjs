// Comments written by other agents (RoboTeam robots) for discussions of the Subtopic matches tab. Scout generates
// none itself; it stores each comment in the generations table, where the discussion view already shows comments.
import { fail } from '../embeddings/config.mjs';

export const commentLimits = Object.freeze({ length: 10000, name: 200 });

const clean = (value, name, max, { multiline = false, optional = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw fail('INPUT_INVALID', `${name} is required`);
  }
  if (typeof value !== 'string') throw fail('INPUT_INVALID', `${name} must be text`);
  const text = multiline ? value.replace(/\r\n?/g, '\n').trim() : value.replace(/\s+/g, ' ').trim();
  const control = multiline ? /[\u0000-\u0008\u000b-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  if (!text || text.length > max || control.test(text)) {
    throw fail('INPUT_INVALID', `${name} needs 1–${max} printable characters`);
  }
  return text;
};

export const batchLimit = 100;

// item and project identify one discussion as scout_discussions_list returns it (its id and project).
// Without a subtopic, the comment is filed under the discussion's best-scoring subtopic.
function addComment(store, input) {
  const item = clean(input.item, 'item', 200);
  const project = clean(input.project, 'project', 200);
  const comment = clean(input.comment, 'comment', commentLimits.length, { multiline: true });
  const agent = clean(input.agent, 'agent', commentLimits.name, { optional: true }) ?? 'agent';
  const model = clean(input.model, 'model', commentLimits.name, { optional: true });
  const discussion = store.db.prepare(`SELECT t.label, th.content_hash FROM topics t JOIN threads th ON th.item=?
    WHERE t.project=? AND t.active=1 AND th.error IS NULL`).get(item, project);
  if (!discussion) throw fail('DISCUSSION_UNKNOWN', 'No readable discussion with this item for an active topic');
  const known = store.db.prepare('SELECT id, text FROM subtopics WHERE project=? ORDER BY id').all(project);
  let subtopic = clean(input.subtopic, 'subtopic', 500, { optional: true });
  if (subtopic) {
    const match = known.find(row => row.text.toLowerCase() === subtopic.toLowerCase());
    if (!match) throw fail('SUBTOPIC_UNKNOWN', `Topic "${discussion.label}" has no subtopic "${subtopic}"`);
    subtopic = match.text;
  } else {
    subtopic = store.db.prepare(`SELECT st.text FROM thread_scores ts JOIN subtopics st ON st.id=ts.subtopic
      WHERE ts.item=? AND st.project=? AND ts.content_hash=? ORDER BY ts.score DESC LIMIT 1`)
      .get(item, project, discussion.content_hash)?.text ?? known[0]?.text;
    if (!subtopic) throw fail('SUBTOPIC_UNKNOWN', `Topic "${discussion.label}" has no subtopics`);
  }
  const now = new Date().toISOString();
  const { lastInsertRowid } = store.db.prepare(`INSERT INTO generations(item, project, topic, subtopic, agent, model,
    status, comment, log, created_at, started_at, finished_at) VALUES(?,?,?,?,?,?,'done',?,'',?,?,?)`)
    .run(item, project, discussion.label, subtopic, agent, model, comment, now, now, now);
  return { status: 'added', id: Number(lastInsertRowid), item, project, topic: discussion.label, subtopic, agent, model };
}

// Stores a batch in one transaction: every comment is stored, or none. A rejected entry names its index. Shared agent
// and model names apply to entries that do not set their own.
export function addComments(store, input) {
  const { comments } = input;
  if (!Array.isArray(comments) || !comments.length || comments.length > batchLimit) {
    throw fail('INPUT_INVALID', `comments must be a list of 1–${batchLimit} comments`);
  }
  const shared = { agent: input.agent, model: input.model };
  const stored = store.transaction(() => comments.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw fail('INPUT_INVALID', `comments[${index}] must be an object`);
    try { return addComment(store, { ...shared, ...Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined)) }); }
    catch (error) { throw Object.assign(error, { message: `comments[${index}]: ${error.message}` }); }
  }));
  return { status: 'added', count: stored.length, comments: stored.map(({ status, ...comment }) => comment) };
}
