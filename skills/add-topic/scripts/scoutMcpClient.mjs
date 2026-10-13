// MCP client for the promotionScout Ploinky agent. Each Scout skill carries an identical copy so it stays
// self-contained. Calls go through the Ploinky router with Ploinky's own agent client, which signs them with the
// caller's identity; the router authenticates and authorizes every call.
//
// The client is found in one of two places:
// - in a RoboTeam robot session, RoboTeam mounts /workspace/ploinky-runtime with the client SDK and context.json
//   (the Ploinky environment and an optional user-delegation token);
// - inside a Ploinky agent container, the bundled client is /Agent/client/AgentMcpClient.mjs.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const AGENT_NAME = process.env.SCOUT_AGENT_NAME || 'promotionScout';
const RUNTIME_DIRECTORY = process.env.SCOUT_PLOINKY_RUNTIME || '/workspace/ploinky-runtime';
const AGENT_CLIENT = '/Agent/client/AgentMcpClient.mjs';

async function loadPloinkyClient(directory) {
  let context;
  try { context = JSON.parse(await readFile(join(directory, 'context.json'), 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { module: await import(AGENT_CLIENT), userDelegationToken: '' };
  }
  if (context.version !== 2) throw new Error('Unsupported Ploinky runtime context.');
  for (const [name, value] of Object.entries(context.env || {})) {
    // Only the Ploinky SDK settings RoboTeam provides; never secrets.
    if (!name.startsWith('PLOINKY_') || /MASTER|PRIVATE_SECRET|SUBJECT|PASSWORD/i.test(name) || typeof value !== 'string') {
      throw new Error('Invalid Ploinky runtime environment.');
    }
    process.env[name] = value;
  }
  const module = await import(pathToFileURL(join(directory, 'sdk/client/AgentMcpClient.mjs')).href);
  return { module, userDelegationToken: context.userDelegationToken || '' };
}

// Scout tools print one JSON value; expected failures come back as {error: {code, message}}.
export function toolValue(result) {
  let value = result;
  if (Array.isArray(result?.content)) {
    const text = result.content.find(entry => entry?.type === 'text' && typeof entry.text === 'string'
      && !entry.text.startsWith('stderr:'))?.text;
    try { value = JSON.parse(text ?? 'null'); }
    catch { throw new Error(`${AGENT_NAME} returned a result that is not JSON.`); }
  }
  if (value?.error) {
    throw Object.assign(new Error(value.error.message || 'Scout tool failed.'), { code: value.error.code });
  }
  return value;
}

export async function createScoutClient({ runtimeDirectory = RUNTIME_DIRECTORY } = {}) {
  let loaded;
  try { loaded = await loadPloinkyClient(runtimeDirectory); }
  catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    throw new Error('The Ploinky MCP client is unavailable: run this skill in a RoboTeam robot session or inside a Ploinky agent.');
  }
  const client = await loaded.module.createAgentClient(AGENT_NAME, { userDelegationToken: loaded.userDelegationToken });
  return { call: async (tool, args = {}) => toolValue(await client.callTool(tool, args)) };
}
