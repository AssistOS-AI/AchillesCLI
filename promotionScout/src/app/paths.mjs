import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export function globalDataDir(env = process.env) {
  const base = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME)
    ? env.XDG_DATA_HOME : join(homedir(), '.local', 'share');
  return join(base, 'promotion-scout');
}

// The Ploinky agent points SCOUT_DATA_DIR at its /data volume (.data/promotionScout in the workspace).
export function resolveDataDir(env = process.env) {
  return env.SCOUT_DATA_DIR && isAbsolute(env.SCOUT_DATA_DIR) ? env.SCOUT_DATA_DIR : globalDataDir(env);
}
