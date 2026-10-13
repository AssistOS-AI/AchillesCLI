import { parentPort, workerData } from 'node:worker_threads';
import { createTransformersProvider } from './transformers.mjs';

// Hosts the ONNX model off the main thread: inference can take seconds per document and would
// otherwise stall the cycle process. Errors cross the thread boundary as { code, message }.
const describe = error => ({ code: error?.code ?? 'INFERENCE_FAILED', message: error?.message ?? String(error) });
let provider;
try {
  provider = await createTransformersProvider(workerData.profile, workerData.options);
  parentPort.postMessage({ ready: true });
} catch (error) {
  parentPort.postMessage({ failed: describe(error) });
}
parentPort.on('message', async ({ id, texts, kind, dispose }) => {
  try {
    if (dispose) { await provider?.dispose(); parentPort.postMessage({ id, vectors: [] }); return; }
    parentPort.postMessage({ id, vectors: await provider.embed(texts, kind) });
  } catch (error) { parentPort.postMessage({ id, error: describe(error) }); }
});
