import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export function fail(code, message, status = undefined) {
  return Object.assign(new Error(message), status === undefined ? { code } : { code, status });
}

export function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function loadProfile({ config, model } = {}) {
  const path = config ?? new URL('../../config/embedding-models.json', import.meta.url);
  const catalog = JSON.parse(await readFile(path, 'utf8'));
  const name = model ?? catalog.defaultModel;
  const raw = catalog.models?.[name];
  if (!raw) throw fail('MODEL_UNKNOWN', `Unknown model profile: ${name}`);
  const fields = ['provider', 'model', 'revision', 'dtype', 'dimensions', 'pooling', 'maxTokens', 'queryPrefix', 'documentPrefix'];
  const profile = Object.fromEntries(fields.map(key => [key, raw[key]]));
  for (const key of ['provider', 'model', 'revision', 'dtype', 'pooling']) {
    if (typeof profile[key] !== 'string' || !profile[key]) throw fail('CONFIG_INVALID', `Missing ${key} in ${name}`);
  }
  if (!/^[a-f0-9]{40}$/.test(profile.revision)) throw fail('CONFIG_INVALID', 'revision must be a full immutable commit SHA');
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+$/.test(profile.model) || profile.model.includes('..')) {
    throw fail('CONFIG_INVALID', 'model must be a Hugging Face owner/repository ID');
  }
  for (const key of ['dimensions', 'maxTokens']) {
    if (!Number.isSafeInteger(profile[key]) || profile[key] < 1) throw fail('CONFIG_INVALID', `${key} must be a positive integer`);
  }
  for (const key of ['queryPrefix', 'documentPrefix']) {
    if (typeof profile[key] !== 'string') throw fail('CONFIG_INVALID', `${key} must be a string`);
  }
  // The relevance threshold belongs to the model but is not part of vector semantics or the namespace.
  const threshold = raw.threshold;
  if (typeof threshold !== 'number' || !(threshold > -1 && threshold < 1)) throw fail('CONFIG_INVALID', `threshold must be between -1 and 1 in ${name}`);
  // Discussions are judged against subtopics with their own threshold; a profile without one reuses the topic threshold.
  const subtopicThreshold = raw.subtopicThreshold ?? threshold;
  if (typeof subtopicThreshold !== 'number' || !(subtopicThreshold > -1 && subtopicThreshold < 1)) {
    throw fail('CONFIG_INVALID', `subtopicThreshold must be between -1 and 1 in ${name}`);
  }
  return { name, profile, threshold, subtopicThreshold };
}

export async function loadCatalog(config) {
  return JSON.parse(await readFile(config ?? new URL('../../config/embedding-models.json', import.meta.url), 'utf8'));
}
