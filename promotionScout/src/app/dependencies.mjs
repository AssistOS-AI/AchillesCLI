import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const moduleRoots = (env = process.env) => [join(packageRoot, 'node_modules'), ...(env.NODE_PATH ?? '').split(':').filter(Boolean)];

// Ploinky prepares node_modules from package.json (NODE_PATH points at it in the container); the install step
// fails clearly when a package is missing.
export function missingDependencies(names = Object.keys(manifest.dependencies), roots = moduleRoots()) {
  return names.filter(name => !roots.some(root => existsSync(join(root, name, 'package.json'))));
}
