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

The call path uses `AgentMcpClient` directly via `createAgentClient` and invokes
`callToolWithoutWait`. When `execute-task` returns a task id, the client offers
it to the process-local background-task observer and returns without
client-owned polling. The observer owns subsequent router-mediated status
polling and log reporting. Detached or otherwise asynchronous calls return the
generic acknowledgement `Task started.` because the task module shows the agent id and description.
