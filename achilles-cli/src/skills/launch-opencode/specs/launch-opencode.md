# Launch OpenCode Specification

## Core Content

The `launch-opencode` C-Skill delegates a natural-language task to the
workspace `opencodeAgent` by calling its `execute-task` MCP tool. The public
input is task text, optionally prefixed as `model: <model> task: <task text>`.
The agent name is intentionally not part of the public grammar because OpenCode
is a named provider launcher, not a generic agent-dispatch utility.

The skill maps the task text into the `prompt` argument required by
`opencodeAgent.execute-task`. It resolves `projectDir` from
`invocation.mainAgent.startDir`, which is the AchillesCLI session working
directory, and uses the hardcoded model
`xai/grok-4.20-0309-non-reasoning` unless the input provides an explicit model
override. The resulting MCP payload must contain `prompt`, `projectDir`, and
`model`.

The skill returns plain text only. Successful runs return
`OpenCode task completed.` and append the bounded `outputText` returned by
`opencodeAgent.execute-task` when that field is non-empty. Failed runs return
the agent error text or an MCP failure message.

When `execute-task` is registered as an async MCP tool and returns a task id, the
skill passes `onTaskUpdate` to `AgentMcpClient.callTool`, which handles polling
internally (5 seconds). New bounded `logTail` content from the task queue is
emitted through the invocation progress writer or supervisor output writer as
intermediate progress. The final user-visible return value remains plain text.

The call path must remain Ploinky-mediated through Ploinky
`AgentMcpClient.mjs`. The skill imports that client directly from the mounted
`/Agent/client/AgentMcpClient.mjs` path with a normal static ESM import. The
client must call `opencodeAgent` through the router at `/opencodeAgent/mcp` and
poll `/opencodeAgent/task`; the skill must not use AchillesCLI's legacy MCP
helper or any local path fallback.

## Decisions & Questions

1. The skill is named `launch-opencode` to match the existing
   `launch-open-interpreter` and `launch-web-search` provider-launcher pattern.
2. `opencodeAgent` is fixed internally for this version. A future generic
   agent caller would be a separate skill with a different security contract.
3. The default model is `xai/grok-4.20-0309-non-reasoning`; callers may override
   it with the explicit `model: <model> task: <task text>` input form.
4. Async polling uses the task id returned by AgentServer metadata, not the
   human-readable queued-task message.
