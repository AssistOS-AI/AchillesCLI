import { loadProfile } from '../embeddings/config.mjs';
import { embeddingSpace, providers } from '../embeddings/index.mjs';
import { loadSettings } from '../app/config.mjs';
import { openStore } from '../app/store.mjs';
import { resolveDataDir } from '../app/paths.mjs';

// Everything one tool call, cycle or the daemon needs: settings, the model profile and an open store.
export async function openContext({ dataDir = resolveDataDir(), profile: chosen, threshold: chosenThreshold,
  registry = providers } = {}) {
  const settings = await loadSettings(dataDir);
  const loaded = chosen ? { name: chosen.model, profile: chosen, threshold: chosenThreshold ?? 0.75 } : await loadProfile();
  const { profile, threshold } = loaded;
  const store = await openStore(dataDir);
  return { dataDir, settings, store, profile, registry, model: loaded.name, threshold,
    subtopicThreshold: loaded.subtopicThreshold ?? threshold, space: embeddingSpace(profile, registry),
    close: () => store.close() };
}
