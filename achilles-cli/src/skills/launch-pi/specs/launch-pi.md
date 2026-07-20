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

The call path uses `AgentMcpClient` directly via `createAgentClient` and invokes
`callToolWithoutWait`. Before the MCP call, it checks Marketplace status for
`AchillesCLI/piAgent`, enables the installed agent only when it is not already
running, requests `global` mode for that activation, and waits for readiness. When `execute-task` returns a task id, the client offers
it to the process-local background-task observer and returns without
client-owned polling. The observer owns subsequent router-mediated status
polling and log reporting. Detached or otherwise asynchronous calls return the
generic acknowledgement `Task started.` because the task module shows the agent id and description.
