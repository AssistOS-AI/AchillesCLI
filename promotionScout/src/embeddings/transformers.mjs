import { fail } from './config.mjs';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';

export const runtimeVersion = 'transformers-4.3.1/cpu/normalized-v3';

export async function createTransformersProvider(profile, { cacheDir, download = false } = {}) {
  // "sentence" uses a model's own sentence_embedding output, which already includes its pooling and projection layers.
  if (!['mean', 'cls', 'sentence'].includes(profile.pooling)) throw fail('CONFIG_INVALID', 'Supported pooling: mean, cls, sentence');
  if (!['q8', 'int8', 'uint8', 'fp32', 'fp16', 'q4', 'q4f16', 'bnb4'].includes(profile.dtype)) {
    throw fail('CONFIG_INVALID', `Unsupported dtype: ${profile.dtype}`);
  }
  let runtime;
  try {
    runtime = await import('@huggingface/transformers');
  } catch (cause) {
    throw fail('DEPENDENCY_MISSING', `Embeddings require @huggingface/transformers 4.3.1. Restart the agent so its install step prepares it. ${cause.message}`);
  }
  if (runtime.env.version !== '4.3.1') {
    throw fail('DEPENDENCY_INCOMPATIBLE', `Expected Transformers.js 4.3.1, found ${runtime.env.version}. Restart the agent so its install step prepares it.`);
  }
  let extractor;
  try {
    const options = {
      revision: profile.revision,
      dtype: profile.dtype,
      device: 'cpu',
      cache_dir: cacheDir,
      local_files_only: !download,
      session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
    };
    // 4.3.1 discovers tokenizer files without forwarding revision/offline options.
    // An absolute local path prevents those metadata requests during inference.
    const modelPath = download ? profile.model : resolve(cacheDir, profile.model, profile.revision);
    const tokenizer = await runtime.AutoTokenizer.from_pretrained(modelPath, options);
    const model = await runtime.AutoModel.from_pretrained(modelPath, options);
    const tokenLimit = Math.min(tokenizer.model_max_length, model.config.max_position_embeddings ?? Infinity);
    if (profile.maxTokens > tokenLimit) {
      await model.dispose();
      throw fail('CONFIG_INVALID', `maxTokens ${profile.maxTokens} exceeds this model/tokenizer limit ${tokenLimit}`);
    }
    extractor = new runtime.FeatureExtractionPipeline({ task: 'feature-extraction', model, tokenizer });
  } catch (cause) {
    if (cause.code === 'CONFIG_INVALID') throw cause;
    throw fail(download ? 'MODEL_DOWNLOAD_FAILED' : 'MODEL_UNAVAILABLE',
      `${profile.model}: ${cause.message}. Restart the agent so its install step downloads the default model.`);
  }
  return {
    async embed(texts, kind) {
      const prefix = kind === 'query' ? profile.queryPrefix : profile.documentPrefix;
      const vectors = [];
      for (const text of texts) {
        const input = prefix + text;
        const encoded = await extractor.tokenizer(input, { truncation: false, padding: false });
        const count = encoded.input_ids.size;
        if (count > profile.maxTokens) {
          throw fail('TEXT_TOO_LONG', `Text has ${count} tokens including prefix; ${profile.model} allows ${profile.maxTokens}. Split it into smaller passages.`);
        }
        if (profile.pooling === 'sentence') {
          const output = await extractor.model(encoded);
          if (!output.sentence_embedding) throw fail('CONFIG_INVALID', `${profile.model} has no sentence_embedding output`);
          vectors.push(Array.from(output.sentence_embedding.data));
          continue;
        }
        const result = await extractor(input, {
          pooling: profile.pooling, normalize: true, truncation: true, max_length: profile.maxTokens,
        });
        vectors.push(Array.from(result.data));
      }
      return vectors;
    },
    async dispose() { await extractor.dispose(); },
  };
}

// Runs the same provider inside a worker thread so long inference never blocks the server's event loop.
export async function createWorkerTransformersProvider(profile, options = {}) {
  // --input-type applies only to eval input and is rejected by workers.
  const execArgv = process.execArgv.filter(arg => !arg.startsWith('--input-type'));
  const worker = new Worker(new URL('./transformers-worker.mjs', import.meta.url), { workerData: { profile, options }, execArgv });
  const pending = new Map();
  let next = 0, settleReady;
  const ready = new Promise((resolve, reject) => { settleReady = { resolve, reject }; });
  const rebuild = ({ code, message }) => fail(code, message);
  const abandon = error => {
    settleReady.reject(error);
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  worker.on('message', message => {
    if (message.ready) return settleReady.resolve();
    if (message.failed) return abandon(rebuild(message.failed));
    const job = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) job?.reject(rebuild(message.error)); else job?.resolve(message.vectors);
  });
  worker.on('error', error => abandon(fail('INFERENCE_FAILED', `Inference worker failed: ${error.message}`)));
  worker.on('exit', code => abandon(fail('INFERENCE_FAILED', `Inference worker exited with code ${code}`)));
  const call = request => new Promise((resolve, reject) => {
    const id = next++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, ...request });
  });
  try { await ready; } catch (error) { await worker.terminate(); throw error; }
  return {
    embed: (texts, kind) => call({ texts, kind }),
    async dispose() {
      try { await call({ dispose: true }); } finally { worker.removeAllListeners('exit'); await worker.terminate(); }
    },
  };
}
