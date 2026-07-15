---
id: DS012
title: OpenCode Launcher Delegation
status: active
owner: AchillesCLI Maintainers
summary: Defines the contract for delegating AchillesCLI tasks to the OpenCode Ploinky agent.
---

# DS012-opencode-launcher-delegation

## Introduction
This DS defines the bounded OpenCode launcher delegation contract implemented
by the `launch-opencode` C-Skill and the OpenAI-compatible surface exposed by
the `opencodeAgent` Ploinky agent. The feature exists to let AchillesCLI route
a plain user task to the known `opencodeAgent` without turning general chat
handling into an unrestricted agent invocation surface, while also allowing
Soul Gateway to discover and call OpenCode as an agent-backed provider.

## Core Content
The public skill input must be plain task text. The target agent is not part of
the public grammar. The skill must reject missing task text before making any
MCP request.

The fixed target is `opencodeAgent`, and the fixed MCP tool is `execute-task`.
The `copilot-router` oskill resolves explicit `opencode` or `opencodeAgent`
user requests to `launch-opencode` so users do not provide agent names as skill
input. The skill must not shell out to OpenCode or any other provider command
directly.

The delegated MCP payload must include `prompt`, `projectDir`, and `model`,
because `opencodeAgent.execute-task` requires that schema. `prompt` is the task
description. `projectDir` comes from `invocation.mainAgent.startDir`, the
AchillesCLI session working directory. `model` is hardcoded to
`xai/grok-4.20-0309-non-reasoning`.

The skill returns plain text only. Successful runs return
`OpenCode task completed.` and append bounded final OpenCode output when the
agent returns it. Failed runs return the agent error text or an MCP failure
message.

The launcher uses `AgentMcpClient.callToolWithoutWait`. If the target tool is
registered as an async MCP tool and the call returns AgentServer task metadata,
AchillesCLI WebChat detaches the task through its generic background-task
observer. The skill returns `Task started` immediately, allowing the
conversation to continue, while the observer polls through the
Ploinky-mediated task-status path and emits task lifecycle and log envelopes.
Callers that require the terminal result use the separate blocking `callTool`
method instead of the launcher path.

The call path must remain Ploinky-mediated through Ploinky
`AgentMcpClient.mjs`. The AchillesCLI runtime must have `PLOINKY_AGENT_ID` and
`PLOINKY_AGENT_SECRET`, and the skill must import the Ploinky client directly
from `/Agent/client/AgentMcpClient.mjs` with a normal static ESM import. That
client must call
`/opencodeAgent/mcp` and poll `/opencodeAgent/task` through the router. The
skill must not use AchillesCLI's legacy invocation-token MCP helper or a local
path fallback for this delegation.

The `copilot-router` oskill must select `launch-opencode` before the more
general execution-provider launchers when the user explicitly asks for
`opencode` or `opencodeAgent`. This keeps named-provider intent from being
captured by generic Open Interpreter routing.

The AchillesCLI Ploinky manifest must enable `copilot-agents/opencodeAgent
global` as a blocking dependency so the OpenCode agent runs against the same
workspace as Copilot.

The `opencodeAgent` manifest must expose AgentServer `endpoints.chatCompletions`
and `endpoints.models` handlers. The chat-completions handler must reuse the
same OpenCode execution runner as `execute-task`, must require an OpenCode
model id from the OpenAI request `model` field, and must transform request
messages into a single OpenCode prompt. The chat-completions handler must run
OpenCode in `WORKSPACE_PATH`, which is the effective workspace path mounted by
Ploinky for the agent. It must not use `PLOINKY_WORKSPACE_ROOT` as the chat
completion project directory. Streaming is not part of this contract; the
manifest must leave streaming disabled so AgentServer rejects streaming
requests before invoking the handler.

The models handler must list OpenCode models through the OpenCode CLI and
return an OpenAI-style `object: "list"` response. Each returned model id must
remain the exact OpenCode model id, such as `opencode/gpt-5` or `xai/grok-4.3`.
Descriptors must include the standardized Soul Gateway fields for
`modelId`, `providerModelId`, display name, token pricing when available,
context and output limits when available, tool and vision capability flags, and
the tags `coding` and `agentic`. Free OpenCode models must use
`pricingMode: "free"`, models with numeric input or output prices must use
`pricingMode: "token"`, and models whose pricing is unavailable must use
`pricingMode: "external_directory"`.

## Decisions & Questions
### Question #1: Why is the launcher fixed to OpenCode instead of accepting any agent name?
Response: External agent invocation is a security-sensitive Ploinky surface.
This launcher supports only `opencodeAgent` so that the payload mapping, tool
name, policy expectations, and user-facing routing semantics remain auditable.
Additional agents require separate launchers or an explicitly designed generic
caller with its own security contract.

### Question #2: Why is the model not part of the public input?
Response: The requested user interface is intentionally minimal:
task description only. The model is fixed to
`xai/grok-4.20-0309-non-reasoning` so the launcher behavior is stable and does
not depend on session or environment model configuration.

### Question #3: Why does WebChat detach async task polling?
Response: OpenCode tasks can run long enough that blocking the orchestrator
prevents an otherwise independent conversation from continuing. AgentServer
already owns task execution and bounded log tails, so WebChat returns the
start acknowledgement while a generic observer follows the same task id over
the router-mediated authorization path. Terminal and non-WebChat callers keep
the blocking behavior when no observer claims the task.

### Question #4: Why does the chat-completions wrapper use `WORKSPACE_PATH`?
Response: Ploinky sets `WORKSPACE_PATH` to the workspace that the agent should
operate on. For isolated agents that path may be `/root`; for global or devel
agents it is the current workspace path mounted into the container. Using
`PLOINKY_WORKSPACE_ROOT` would confuse host workspace identity with the
effective runtime project directory and can be wrong for the way an agent is
mounted.

### Question #5: Why does `opencodeAgent` expose `/v1/models`?
Response: Soul Gateway treats each Ploinky agent as a provider and discovers
its concrete models from the agent. OpenCode already owns the provider/model
catalog, so `opencodeAgent` must publish those models through AgentServer
instead of relying on a synthetic fallback model.

## Conclusion
OpenCode delegation in AchillesCLI is a narrow provider launcher. It lets users
explicitly ask for OpenCode work while preserving Ploinky router mediation,
fixed tool dispatch, deterministic argument mapping, and plain text results.
The same agent also provides an OpenAI-compatible provider surface for Soul
Gateway, with model discovery delegated to OpenCode and execution constrained
to the Ploinky-provided `WORKSPACE_PATH`.
