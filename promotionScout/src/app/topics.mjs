import { hash, fail } from '../embeddings/config.mjs';

export const topicLimits = Object.freeze({ terms: 5, termLength: 100, tags: 5, tagLength: 50 });

export function topicIdentity(value) {
  const label = String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!label || label.length > 1000 || /[\u0000-\u001f\u007f]/.test(label)) {
    throw fail('INPUT_INVALID', 'Topic must contain 1–1000 printable characters.');
  }
  return { label, key: label.toLowerCase(), project: hash(label.toLowerCase()).slice(0, 32) };
}

// Search terms feed sites with a search URL; tags feed sites with tag URLs. Duplicates ignore case.
function phrases(values, name, count, length) {
  if (values === undefined) return undefined;
  if (!Array.isArray(values)) throw fail('INPUT_INVALID', `${name} must be a list of strings`);
  const seen = new Map();
  for (const value of values) {
    if (typeof value !== 'string') throw fail('INPUT_INVALID', `${name} must be a list of strings`);
    const clean = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    if (clean.length > length || /[\u0000-\u001f\u007f]/.test(clean)) {
      throw fail('INPUT_INVALID', `Each of ${name} needs at most ${length} printable characters`);
    }
    if (!seen.has(clean.toLowerCase())) seen.set(clean.toLowerCase(), clean);
  }
  if (seen.size > count) throw fail('INPUT_INVALID', `Use at most ${count} ${name}`);
  return [...seen.values()];
}

export function topicFields({ searchTerms, tags } = {}) {
  return { searchTerms: phrases(searchTerms, 'search terms', topicLimits.terms, topicLimits.termLength),
    tags: phrases(tags, 'tags', topicLimits.tags, topicLimits.tagLength) };
}

export function saveTopic(store, value, remove = false, fields = {}) {
  const { label, key, project } = topicIdentity(value);
  const { searchTerms, tags } = topicFields(fields);
  const existing = store.db.prepare('SELECT * FROM topics WHERE topic_key=?').get(key);
  if (remove) {
    if (!existing) throw fail('TOPIC_UNKNOWN', `Unknown topic: ${label}`);
    store.db.prepare('UPDATE topics SET active=0 WHERE topic_key=?').run(key);
    return { label: existing.label, status: 'removed' };
  }
  if (existing) {
    store.transaction(() => {
      store.db.prepare('UPDATE topics SET active=1 WHERE topic_key=?').run(key);
      if (!existing.active) writeFields(store, key, { searchTerms, tags });
    });
    return { label: existing.label, status: existing.active ? 'already exists' : 'restored' };
  }
  store.transaction(() => {
    const id = freeProject(store, project);
    store.saveProject(id, label);
    store.db.prepare('INSERT INTO topics(project,label,topic_key) VALUES(?,?,?)').run(id, label, key);
    writeFields(store, key, { searchTerms, tags });
  });
  return { label, status: 'added' };
}

function writeFields(store, key, { searchTerms, tags }) {
  if (searchTerms) store.db.prepare('UPDATE topics SET search_terms=? WHERE topic_key=?').run(JSON.stringify(searchTerms), key);
  if (tags) store.db.prepare('UPDATE topics SET tags=? WHERE topic_key=?').run(JSON.stringify(tags), key);
}

// A renamed topic keeps the internal id derived from its first text, so a later topic with that text needs another id.
function freeProject(store, project) {
  let id = project;
  for (let n = 1; store.db.prepare('SELECT 1 FROM projects WHERE name=?').get(id); n++) id = `${project.slice(0, 26)}-${n}`;
  return id;
}

// Renaming keeps the topic's history, subtopics, feeds and fields. The text is the ranking intent, so its change
// invalidates earlier scores and the next run re-ranks the topic's entries.
export function renameTopic(store, value, newLabel) {
  const { key } = topicIdentity(value);
  const next = topicIdentity(newLabel);
  const existing = store.db.prepare('SELECT * FROM topics WHERE topic_key=? AND active=1').get(key);
  if (!existing) throw fail('TOPIC_UNKNOWN', `Unknown topic: ${value}`);
  if (next.label === existing.label) return { label: existing.label, status: 'unchanged', key };
  if (next.key !== key && store.db.prepare('SELECT 1 FROM topics WHERE topic_key=?').get(next.key)) {
    throw fail('TOPIC_EXISTS', `A topic "${next.label}" already exists or was removed with its history; restore or choose another text`);
  }
  store.db.prepare('UPDATE topics SET label=?, topic_key=? WHERE project=?').run(next.label, next.key, existing.project);
  store.saveProject(existing.project, next.label);
  return { label: next.label, status: 'renamed', key: next.key };
}

export function updateTopic(store, value, fields) {
  const { key, label } = topicIdentity(value);
  const existing = store.db.prepare('SELECT * FROM topics WHERE topic_key=? AND active=1').get(key);
  if (!existing) throw fail('TOPIC_UNKNOWN', `Unknown topic: ${label}`);
  writeFields(store, key, topicFields(fields));
  return { label: existing.label, status: 'updated' };
}

export function activeTopics(store) {
  return store.db.prepare('SELECT * FROM topics WHERE active=1 ORDER BY topic_key').all()
    .map(topic => ({ ...topic, search_terms: JSON.parse(topic.search_terms), tags: JSON.parse(topic.tags) }));
}
