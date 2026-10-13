import { cosine, validateText } from '../embeddings/index.mjs';

export async function passages(service, text) {
  try { return [{ text, vector: (await service.embed([text], 'document'))[0] }]; }
  catch (error) {
    if (error.code !== 'TEXT_TOO_LONG') throw error;
    const points = Array.from(text);
    if (points.length < 2) throw error;
    const half = Math.floor(points.length / 2);
    const left = points.slice(0, half).join('').trim(), right = points.slice(half).join('').trim();
    const result = [];
    for (const part of [left, right]) if (part) result.push(...await passages(service, part));
    return result;
  }
}

export async function evaluateProject(store, service, project, days = 7, { feedOnly = false, signal } = {}) {
  const watch = store.project(project);
  validateText(watch.query);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const [query] = await service.embed([watch.query], 'query');
  const evaluations = [];
  for (const item of store.available(project, since, feedOnly)) {
    signal?.throwIfAborted();
    const old = store.db.prepare(`SELECT score,context FROM evaluations
      WHERE project=? AND item=? AND space=? AND watch_hash=? AND content_hash=?`)
      .get(project, item.id, service.space, watch.watch_hash, item.content_hash);
    if (old) { evaluations.push({ ...item, ...old }); continue; }
    const text = `${item.title}\n${item.text}`.trim();
    const chunks = await passages(service, text);
    const ranked = chunks.map(chunk => ({ score: cosine(query, chunk.vector), context: chunk.text }))
      .sort((a, b) => b.score - a.score);
    evaluations.push({ ...item, ...ranked[0] });
  }
  return { evaluations, watch };
}
