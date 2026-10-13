import { join } from 'node:path';
import { hash, fail } from './config.mjs';
import { EmbeddingCache, sqliteRuntime } from './cache.mjs';
import { createWorkerTransformersProvider, runtimeVersion } from './transformers.mjs';

// Add providers by supplying { id: { version, create(profile, options) } }.
// Providers return { embed(texts, kind): Promise<number[][]>, dispose() }.
export const providers = Object.freeze({
  transformers: { version: runtimeVersion, create: createWorkerTransformersProvider },
});

export function validateText(text) {
  if (typeof text !== 'string' || !text.trim()) throw fail('INPUT_INVALID', 'Text must be a nonempty string.');
}

export function normalize(vector, dimensions) {
  if (!Array.isArray(vector) || vector.length !== dimensions || !vector.every(Number.isFinite)) {
    throw fail('EMBEDDING_INVALID', `Expected ${dimensions} finite embedding values.`);
  }
  const norm = Math.hypot(...vector);
  if (!norm || !Number.isFinite(norm)) throw fail('EMBEDDING_INVALID', 'Embedding has zero or invalid magnitude.');
  return vector.map(value => Math.fround(value / norm));
}

export function cosine(a, b) {
  if (a.length !== b.length) throw fail('EMBEDDING_INVALID', 'Cannot compare vectors of different dimensions.');
  return Math.max(-1, Math.min(1, a.reduce((sum, value, i) => sum + value * b[i], 0)));
}

// The namespace identifies vector semantics without loading the model.
export function embeddingSpace(profile, registry = providers) {
  const implementation = registry[profile.provider];
  if (!implementation?.version) throw fail('PROVIDER_UNKNOWN', `Unknown embedding provider: ${profile.provider}`);
  return hash(JSON.stringify({ profile, implementation: implementation.version }));
}

export async function createEmbeddingService(profile, { dataDir, registry = providers } = {}) {
  const implementation = registry[profile.provider];
  if (!implementation?.create || !implementation.version) throw fail('PROVIDER_UNKNOWN', `Unknown embedding provider: ${profile.provider}`);
  const { DatabaseSync } = await sqliteRuntime();
  // Check the model before creating the application's database.
  const provider = await implementation.create(profile, { cacheDir: join(dataDir, 'models') });
  let cache;
  try { cache = new EmbeddingCache(DatabaseSync, join(dataDir, 'scout.sqlite')); }
  catch (error) { await provider.dispose(); throw error; }
  const space = embeddingSpace(profile, registry);
  return {
    space,
    async embed(texts, kind = 'document') {
      if (!['query', 'document'].includes(kind)) throw fail('INPUT_INVALID', 'kind must be query or document');
      if (!Array.isArray(texts) || !texts.length) throw fail('INPUT_INVALID', 'Provide at least one text.');
      texts.forEach(validateText);
      const output = [];
      for (const text of texts) {
        const key = hash(text);
        let vector = cache.get(space, kind, key, profile.dimensions);
        if (!vector) {
          const results = await provider.embed([text], kind);
          if (!Array.isArray(results) || results.length !== 1) throw fail('EMBEDDING_INVALID', 'Provider returned an unexpected number of vectors.');
          vector = normalize(results[0], profile.dimensions);
          cache.set(space, kind, key, vector);
        } else {
          vector = normalize(vector, profile.dimensions);
        }
        output.push(vector);
      }
      return output;
    },
    async rank(query, documents, limit = 20) {
      validateText(query);
      if (!Array.isArray(documents)) throw fail('INPUT_INVALID', 'Input must be a JSON array of documents.');
      if (!Number.isSafeInteger(limit) || limit < 1) throw fail('INPUT_INVALID', 'limit must be a positive integer');
      for (const doc of documents) validateText(doc?.text);
      if (!documents.length) return [];
      const [queryVector] = await this.embed([query], 'query');
      const vectors = await this.embed(documents.map(doc => doc.text), 'document');
      return documents.map((document, i) => ({
        ...document, similarity: cosine(queryVector, vectors[i]), embeddingSpace: space,
      })).sort((a, b) => b.similarity - a.similarity).slice(0, limit);
    },
    async dispose() {
      try { cache.close(); } finally { await provider.dispose(); }
    },
  };
}
