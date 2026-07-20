# Launch Codex Specification

## Core Content

The `launch-codex` C-Skill delegates a plain natural-language task to the
workspace `codexAgent` by calling its asynchronous `execute-task` MCP tool. The
public input is only the task text. Structured input and model parameters are
not part of the launcher contract.

The skill maps task text to `prompt` and resolves `projectDir` from
`invocation.mainAgent.startDir`. The delegated payload contains only those two
fields. The launcher does not inherit or forward AchillesCLI's selected model;
Codex resolves its current configuration inside the provider runtime.

The provider starts `codex exec --json` without ephemeral mode, persists the
reported Codex thread id behind an opaque UUID handle, and retains full live
task logs. Provider stderr is forwarded unchanged. Textual agent and command
output extracted from Codex JSONL events is forwarded immediately without
synthetic prefixes or lifecycle lines. Structured final-result stdout is not
duplicated into the live log.

Continuation remains provider-owned. `continue-task` resolves the opaque
handle to the original Codex thread and project directory, then invokes
`codex exec resume` without a model flag. Omitting the flag makes every
continuation use the model configured at continuation time instead of storing
or replaying the model used to start the thread. WebChat keeps the same local
task while each continuation is a new asynchronous remote execution.

The provider wrappers treat `SIGTERM` as controlled cancellation. They abort
the active Codex subprocess and, if a thread id was already reported, persist
and return its existing opaque continuation handle before exiting
unsuccessfully. This lets WebChat resume a cancelled running task on the same
local task id; queued work cancelled before Codex starts has no continuation
capability.

The call path uses Ploinky `AgentMcpClient` through
`ensureAgentsRunning` and `callToolWhenReady`. It checks Marketplace status for
`AchillesCLI/codexAgent`, enables the installed agent in explicit `global` mode
only when it is not running, waits for readiness, and calls
`callToolWithoutWait`. A returned async task id is owned by the background-task
observer; the skill returns `Task started.` without client-side polling.

## Decisions & Questions

### Question #1: Why is the model omitted from continuation?

Response:
The current Codex configuration is the authority for a new turn. The private
continuation record stores only the provider thread id and original project
directory, so a historical model choice cannot leak back into resumed work.

### Question #2: Why is Codex run with bypassed approvals and sandboxing?

Response:
The Codex process already runs inside the isolated Ploinky agent container.
Non-interactive WebChat tasks cannot answer approval prompts, so the provider
uses Codex's explicit automation flag and documents that trust boundary.
