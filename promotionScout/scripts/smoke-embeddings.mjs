import assert from 'node:assert/strict';
import { resolveDataDir } from '../src/app/paths.mjs';
import { performance } from 'node:perf_hooks';
import { loadProfile } from '../src/embeddings/config.mjs';
import { createEmbeddingService } from '../src/embeddings/index.mjs';

const model = process.argv[2];
// Fail the test if local inference attempts even a metadata network request.
globalThis.fetch = async url => { throw new Error(`Unexpected network request: ${url}`); };
const { name, profile } = await loadProfile({ model });
const started = performance.now();
const service = await createEmbeddingService(profile, { dataDir: resolveDataDir() });
try {
  const query = name === 'minilm-en' ? 'A beginner book about growing vegetables on a balcony' : 'O carte pentru începători despre cultivarea legumelor pe balcon';
  const results = await service.rank(query, [
    { id: 'relevant', text: 'Can anyone recommend a beginner book about growing vegetables in pots on a balcony?' },
    { id: 'unrelated', text: 'The football team won the championship after scoring two goals.' },
  ]);
  assert.equal(results[0].id, 'relevant');
  const [vector] = await service.embed(['A gardening book'], 'query');
  assert.equal(vector.length, profile.dimensions);
  assert.ok(Math.abs(Math.hypot(...vector) - 1) < 0.00001);
  await assert.rejects(service.embed(['vegetables '.repeat(profile.maxTokens + 10)]), { code: 'TEXT_TOO_LONG' });
  // Inference runs in a worker thread: a long document must not stall the server's event loop.
  let stall = 0, last = performance.now();
  const timer = setInterval(() => { const now = performance.now(); stall = Math.max(stall, now - last - 50); last = now; }, 50);
  await service.embed([Array.from({ length: Math.floor(profile.maxTokens / 3) }, (_, i) => `word${i % 97}`).join(' ')], 'document');
  clearInterval(timer);
  assert.ok(stall < 250, `event loop stalled ${Math.round(stall)} ms during inference`);
  console.log(JSON.stringify({ model: name, milliseconds: Math.round(performance.now() - started), maxRssMB: Math.round(process.resourceUsage().maxRSS / 1024), results }, null, 2));
} finally { await service.dispose(); }
