# Launch PI Specification

## Core Content

The `launch-pi` C-Skill delegates a plain natural-language task to the workspace
`piAgent` by calling its `execute-task` MCP tool. The public input is only the
plain task text. Structured input and model parameters are not part of the
launcher contract.

The skill maps the task text into the `prompt` argument required by
`piAgent.execute-task`. It resolves `projectDir` from `invocation.mainAgent.startDir`,
does not parse JSON or prefixed field syntax, and does not inherit or forward
the AchillesCLI session model. `piAgent` owns model selection.

The payload sent to the delegated tool contains only `prompt` and `projectDir`.
The provider executes in PI JSON event-stream mode. Its JSONL stdout and stderr
are consumed incrementally. Assistant text deltas and de-duplicated textual tool
output are forwarded immediately to the task log without synthetic status
messages. The final assistant `message_end` text becomes the structured task
result. Lifecycle events, thinking content, signatures, encrypted content, and
usage metadata are omitted; non-JSON diagnostics and provider stderr remain
visible.
The provider task runner keeps `HOME=/root` and does not override
`PI_CODING_AGENT_DIR`; PI therefore uses its persistent default agent
configuration for interactive CLI sessions, initial tasks, and continuations.
OAuth credentials created through the interactive `/login` flow and persistent
provider settings are shared by all three paths.
Continuation remains provider-owned: `piAgent` reads its persistent global PI
settings, applies project-local overrides for the original project directory,
and passes the effective provider, model, and valid thinking level explicitly
when resuming the stored session. Missing or malformed settings retain PI's
native session-resume selection. Neither AchillesCLI nor WebChat sends these
provider-specific values.

The skill returns plain text only. Successful runs return `PI task completed.`
and append the bounded `outputText` returned by `piAgent.execute-task` when that
field is non-empty. Failed runs return the agent error text or an MCP failure
message.
Allowlisted lifecycle failures surface their stable code with a fixed safe
description. The launcher must not include command lines, environment values,
credentials, hidden routing state, or raw diagnostic tails with such a code.

The call path uses `AgentMcpClient` directly via `createAgentClient` and invokes
`callToolWithoutWait`. Before the MCP call, it checks Marketplace status for
`AchillesCLI/piAgent`, enables the installed agent only when it is not already
running, requests `global` mode for that activation, and waits for readiness. When `execute-task` returns a task id, the client offers
it to the process-local background-task observer and returns without
client-owned polling. The observer owns subsequent router-mediated status
polling and log reporting. Detached or otherwise asynchronous calls return the
generic acknowledgement `Task started.` because the task module shows the agent id and description.

The PI execution and continuation wrappers handle `SIGTERM` as controlled
cancellation. They abort the active PI subprocess and preserve the
preallocated provider session behind the same opaque continuation handle before
exiting unsuccessfully. The cancelled remote task can therefore be resumed as
a later turn of the same WebChat task. Cancellation while still queued never
starts the wrapper and exposes no continuation capability.
Both provider task tools are internal MCP capabilities invoked by AchillesCLI
as the verified source agent. WebChat sends the CLI command and never invokes
`continue-task` directly.
