# Launch PI Specification

## Core Content

The `launch-pi` C-Skill delegates a plain natural-language task to the workspace
`piAgent` by calling its `execute-task` MCP tool. The public input is task text,
optionally prefixed as `model: <model> task: <task text>`. The JSON variant also
accepts an optional `model` override.

The skill maps the task text into the `prompt` argument required by
`piAgent.execute-task`. It resolves `projectDir` from `invocation.mainAgent.startDir`,
and uses the hardcoded default model `claude-3-7-sonnet-20250219` unless the
input provides an explicit model override.

The payload sent to the delegated tool contains `prompt`, `projectDir`, and `model`.

The skill returns plain text only. Successful runs return `PI task completed.`
and append the bounded `outputText` returned by `piAgent.execute-task` when that
field is non-empty. Failed runs return the agent error text or an MCP failure
message.

When `execute-task` is registered as an async MCP tool and returns a task id, the
skill polls the agent task-status endpoint until the task completes, fails, or times
out. New bounded `logTail` content from the task queue may be emitted through
the invocation progress writer as intermediate progress. The final user-visible
return value remains plain text.

The call path uses `AgentMcpClient` directly via `createAgentClient` and
passes `onTaskUpdate` to `callTool`; polling is therefore handled internally by
the MCP client (every 5 seconds), with intermediate `logTail` updates emitted as
`tool_reason`.
