import { fail } from '../embeddings/config.mjs';
import { topicIdentity } from './topics.mjs';

export const subtopicLimits = Object.freeze({ length: 500, perTopic: 200 });

// A subtopic is a free text attached to one topic; discussions are compared with every subtopic of their topics.
export function addSubtopic(store, topicKey, value) {
  const { key, label } = topicIdentity(topicKey);
  const topic = store.db.prepare('SELECT project FROM topics WHERE topic_key=? AND active=1').get(key);
  if (!topic) throw fail('TOPIC_UNKNOWN', `Unknown topic: ${label}`);
  const text = String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!text || text.length > subtopicLimits.length || /[\u0000-\u001f\u007f]/.test(text)) {
    throw fail('INPUT_INVALID', `A subtopic needs 1–${subtopicLimits.length} printable characters`);
  }
  const count = store.db.prepare('SELECT COUNT(*) AS n FROM subtopics WHERE project=?').get(topic.project).n;
  if (count >= subtopicLimits.perTopic) throw fail('INPUT_INVALID', `A topic holds at most ${subtopicLimits.perTopic} subtopics`);
  const result = store.db.prepare('INSERT OR IGNORE INTO subtopics(project,text,text_key,created_at) VALUES(?,?,?,?)')
    .run(topic.project, text, text.toLowerCase(), new Date().toISOString());
  if (!result.changes) return { status: 'already exists', text };
  return { status: 'added', id: Number(result.lastInsertRowid), text };
}

export function removeSubtopic(store, id) {
  if (!store.db.prepare('DELETE FROM subtopics WHERE id=?').run(Number(id)).changes) {
    throw fail('SUBTOPIC_UNKNOWN', `Unknown subtopic: ${id}`);
  }
  return { id: Number(id), status: 'removed' };
}

export function subtopicsOf(store, project) {
  return store.db.prepare('SELECT id, text FROM subtopics WHERE project=? ORDER BY id').all(project);
}

// Replaces a topic's subtopics with the edited list in one step. Entries keep their id when the text is unchanged,
// so existing scores survive; a changed text becomes a new subtopic that is scored again. Call inside a transaction.
export function replaceSubtopics(store, project, entries) {
  if (!Array.isArray(entries)) throw fail('INPUT_INVALID', 'subtopics must be a list of { id?, text }');
  const existing = new Map(subtopicsOf(store, project).map(row => [row.id, row.text]));
  const wanted = [], keys = new Set();
  for (const entry of entries) {
    const text = String(entry?.text ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (text.length > subtopicLimits.length || /[\u0000-\u001f\u007f]/.test(text)) {
      throw fail('INPUT_INVALID', `A subtopic needs 1–${subtopicLimits.length} printable characters`);
    }
    if (keys.has(text.toLowerCase())) continue;
    keys.add(text.toLowerCase());
    wanted.push({ id: existing.get(Number(entry.id)) === text ? Number(entry.id) : null, text });
  }
  if (wanted.length > subtopicLimits.perTopic) throw fail('INPUT_INVALID', `A topic holds at most ${subtopicLimits.perTopic} subtopics`);
  const kept = new Set(wanted.map(entry => entry.id).filter(id => id !== null));
  for (const id of existing.keys()) if (!kept.has(id)) store.db.prepare('DELETE FROM subtopics WHERE id=?').run(id);
  const insert = store.db.prepare('INSERT INTO subtopics(project,text,text_key,created_at) VALUES(?,?,?,?)');
  for (const entry of wanted) if (entry.id === null) insert.run(project, entry.text, entry.text.toLowerCase(), new Date().toISOString());
  return subtopicsOf(store, project);
}
