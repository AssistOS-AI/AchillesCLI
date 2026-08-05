# Launch OpenCode Specification

## Core Content

The `launch-opencode` C-Skill delegates a natural-language task to the
workspace `opencodeAgent` by calling its `execute-task` MCP tool. The public
input is only the plain task text. The agent name and model are intentionally
not part of the public grammar because OpenCode is a named provider launcher,
not a generic agent-dispatch utility.

The skill maps the task text into the `prompt` argument required by
`opencodeAgent.execute-task`. It resolves `projectDir` from
`invocation.mainAgent.startDir`, which is the AchillesCLI session working
directory. That directory is required and exact `/workspace` is rejected; the
launcher never substitutes `process.cwd()` or a workspace-root default. The
resulting MCP payload contains only `prompt` and `projectDir`, and the target
provider boundary performs the authoritative existing-directory validation.
The launcher does not parse structured input, inherit the AchillesCLI session
model, or forward a model override; `opencodeAgent` owns model selection.

The skill returns plain text only. Successful runs return
`OpenCode task completed.` and append the bounded `outputText` returned by
`opencodeAgent.execute-task` when that field is non-empty. Failed runs return
the agent error text or an MCP failure message.
Allowlisted lifecycle failures surface their stable code with a fixed safe
description. The launcher must not include command lines, environment values,
credentials, hidden routing state, or raw diagnostic tails with such a code.

The skill calls `AgentMcpClient.callToolWithoutWait`. When `execute-task` is
registered as an async MCP tool and returns a task id, the client offers it to
the process-local background-task observer and returns without client-owned
polling. The observer owns subsequent router-mediated status polling and log
reporting. Detached or otherwise asynchronous calls return the generic
acknowledgement `Task started.` because the task module shows the agent id and description.

The call path must remain Ploinky-mediated through Ploinky
`AgentMcpClient.mjs`. The skill imports that client directly from the mounted
`/Agent/client/AgentMcpClient.mjs` path with a normal static ESM import. The
client first checks Marketplace status for `AchillesCLI/opencodeAgent`, sends
the existing `enable_agent` action in explicit `global` mode only when it is not already running, and
waits for runtime readiness. It then calls `opencodeAgent` through the router at `/opencodeAgent/mcp`;
observer-owned status reads use `/opencodeAgent/task`. The skill must not use
AchillesCLI's legacy MCP helper or any local path fallback.
The provider's `execute-task` and `continue-task` tools are both internal MCP
capabilities invoked by AchillesCLI as the verified source agent. WebChat only
sends CLI commands and cannot invoke either provider tool directly.

## Decisions & Questions

1. The skill is named `launch-opencode` to match the existing
   `launch-open-interpreter` and `launch-web-search` provider-launcher pattern.
2. `opencodeAgent` is fixed internally for this version. A future generic
   agent caller would be a separate skill with a different security contract.
3. The target agent owns model selection. The launcher accepts task text only
   and never forwards a model parameter.
4. Async polling uses the task id returned by AgentServer metadata, not the
   human-readable queued-task message.
