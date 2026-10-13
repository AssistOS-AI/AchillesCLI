// The agent's MCP tools and task endpoint, reached through the Ploinky router with the operator's session.
// The page is served under /<agent>/web/, so the first path segment is the agent's route.
import { createAgentClient } from '/MCPBrowserClient.js';

const agentRoute = `/${location.pathname.split('/').filter(Boolean)[0] ?? 'promotionScout'}`;
const client = createAgentClient(`${agentRoute}/mcp`);
export const defined = args => Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined && value !== ''));
// Tools print one JSON value; expected failures come back as {error: {code, message}}.
export async function call(tool, args = {}) {
  const result = await client.callTool(tool, defined(args));
  const text = result?.content?.find(entry => entry?.type === 'text' && !entry.text.startsWith('stderr:'))?.text;
  const value = JSON.parse(text ?? 'null');
  if (value?.error) throw Object.assign(new Error(value.error.message), { code: value.error.code });
  return value;
}
// The live log of a cycle is the log of its asynchronous task, read from the agent's task endpoint.
export async function cycleTask(taskId) {
  const response = await fetch(`${agentRoute}/task?taskId=${encodeURIComponent(taskId)}`,
    { headers: { accept: 'application/json' }, credentials: 'include' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Task status: HTTP ${response.status}`);
  return (await response.json()).task ?? null;
}
