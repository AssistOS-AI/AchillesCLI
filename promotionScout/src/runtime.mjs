import { fail } from './embeddings/config.mjs';

export function checkRuntime(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw fail('RUNTIME_UNSUPPORTED', `Node.js >=22.13.0 is required; found ${version}.`);
  }
}
