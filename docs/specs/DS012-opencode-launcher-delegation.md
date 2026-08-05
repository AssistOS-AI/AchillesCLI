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
The public skill input must be plain task text. The target agent and model are
not part of the public grammar. The launcher must treat the complete non-empty
input string as the task, including text that resembles JSON or prefixed
fields, without parsing or rejecting it. The skill must reject missing task
text before making any MCP request.

The fixed target is `opencodeAgent`, and the fixed MCP tool is `execute-task`.
The WebChat named-coding-agent selector resolves explicit `opencode` or
`opencodeAgent` task requests to `launch-opencode` before generic reasoning, so
users do not provide agent names as skill input. The skill must not shell out
to OpenCode or any other provider command directly.

The delegated MCP payload must include only `prompt` and `projectDir`. `prompt`
is the complete task text. `projectDir` comes from
`invocation.mainAgent.startDir`, the AchillesCLI session working directory. The
launcher must not inherit the AchillesCLI session model or forward any model
parameter; the target agent owns model selection.

The skill returns plain text only. Successful runs return
`OpenCode task completed.` and append bounded final OpenCode output when the
agent returns it. Failed runs return the agent error text or an MCP failure
message.

The `opencodeAgent` task wrapper must execute OpenCode in its default formatted
output mode with `--auto`. The repository-owned permission configuration must
allow ordinary tool operations without prompting and explicitly deny
`external_directory`, so auto mode cannot approve access outside the directory
selected through `--dir`. The wrapper must not use
`--dangerously-skip-permissions`. Provider stdout and stderr must be relayed
byte-for-byte into the AgentServer live-log channel without parsing, filtering,
synthetic status messages, or stream prefixes. An initial task must receive an
unpredictable internal title. After execution, the wrapper must query
OpenCode's session-list interface separately and match both that title and the
resolved project directory to capture the provider-issued session id. It must
then inspect that session's exported message data and select the last assistant
text as the bounded `outputText`. Session-list and export output must not enter
visible task logs. The wrapper stdout must be one structured result containing
that final answer and a versioned continuation descriptor. If provider
execution fails after OpenCode created the session, the wrapper must still
persist that session, emit the structured descriptor, and exit unsuccessfully.
TaskQueue retains the descriptor as result metadata for both completed and
failed tasks while exposing `outputText` as ordinary MCP result text only on
success, so provider session details do not enter the visible result or log.
The OpenAI-compatible chat-completions path does not create resumable tasks and
continues to use normal OpenCode text output with the same permission policy.

Initial task execution that creates an OpenCode session must store its session
id and resolved project directory in agent-private persistent storage behind a
random UUID continuation handle, even when the selected model subsequently
fails. The record and its parent directory must reject
symlinks and use restrictive file permissions. `continue-task` accepts only
that handle and a non-empty prompt, loads the record, and reads OpenCode's
agent-local model state immediately before execution. When `recent[0]`
contains valid provider and model ids, continuation must invoke
`opencode run --session <session-id> --model <provider/model>` in the original
project directory. A non-default variant recorded for that model must also be
passed through `--variant`. Missing, malformed, or unreadable model state must
fall back to OpenCode's native session-resume selection rather than failing the
task. The handle is an authority scoped to the internal MCP policy path used by
the verified AchillesCLI agent; WebChat must not invoke the provider tool or
receive the real OpenCode session id, model selection, or a replacement project
directory.

The execute and continuation wrappers must listen for `SIGTERM`, abort the
active OpenCode subprocess, and still complete session discovery and private
handle persistence when OpenCode created a session before cancellation. They
then emit the structured continuation descriptor and exit unsuccessfully.
AgentServer records the task as cancelled while retaining that descriptor, so
AchillesCLI may start a later turn on the same local task id. Work cancelled while
queued never starts OpenCode and therefore has no continuation capability.

The launcher uses `AgentMcpClient.callToolWithoutWait`. If the target tool is
registered as an async MCP tool and the call returns AgentServer task metadata,
AchillesCLI detaches the task through its generic background-task observer in
single-shot, terminal, and WebChat modes. The skill returns `Task started.`
immediately, allowing the conversation to continue, while the observer polls
through the Ploinky-mediated task-status path and persists lifecycle and log
state. WebChat mode additionally emits generic browser envelopes.
Callers that require the terminal result use the separate blocking `callTool`
method instead of the launcher path.

Both `execute-task` and `continue-task` are asynchronous, request full
task-log retention, and impose no elapsed-time limit. They remain active until
OpenCode exits, the user cancels the task, execution fails, or the runtime is
interrupted. `execute-task` advertises `continue-task` as its generic
continuation capability. Every continuation creates a new AgentServer remote
task, while AchillesCLI keeps the original local task id and increments its
turn. A completed or failed task with a persisted handle remains continuable,
as does a cancelled running task whose handle was persisted during controlled
shutdown.

Both tools are tagged `internal`. Initial and continued work therefore share
the same router policy boundary: AchillesCLI signs the agent-to-agent request
in terminal and WebChat modes, while browser users cannot call either provider
tool directly.

The call path must remain Ploinky-mediated through Ploinky
`AgentMcpClient.mjs`. The AchillesCLI runtime must have `PLOINKY_AGENT_ID` and
`PLOINKY_AGENT_SECRET`, and the skill must import the Ploinky client directly
from `/Agent/client/AgentMcpClient.mjs` with a normal static ESM import. That
client must call
`/opencodeAgent/mcp` and poll `/opencodeAgent/task` through the router. The
skill must not use AchillesCLI's legacy invocation-token MCP helper or a local
path fallback for this delegation.

The WebChat named-coding-agent selector must select `launch-opencode` before
generic reasoning or more general execution-provider launchers when the user
explicitly asks `opencode` or `opencodeAgent` to perform a task. This keeps
named-provider intent from being captured by generic Open Interpreter routing.

The AchillesCLI Ploinky manifest must omit `opencodeAgent` from its `enable`
dependencies so Explorer startup is not blocked by an optional coding worker.
Before invoking MCP, `launch-opencode` must use `AgentMcpClient` to read the
installed agent's Marketplace status, submit `enable_agent` for
`AchillesCLI/opencodeAgent` only when it is not already running, and wait until
the runtime reports ready. A transient router response that the new route is
still starting may be retried only inside the bounded startup window.

The `opencodeAgent` default profile must run its repository-owned installation
script before AgentServer starts. The script must install the current OpenCode
release through the official installer, validate the repository-owned
`opencode.json`, and atomically replace
`$HOME/.config/opencode/opencode.json` with restrictive permissions. It must
not replace OpenCode authentication, session, or recent-model state. The
runtime, readiness probe, task runner, models handler, and interactive CLI must
resolve the OpenCode binary from the same effective `HOME` unless an explicit
`OPENCODE_BIN` test or operator override is supplied.

Every OpenCode task process, including session discovery, export, initial
execution, continuation, and the chat-completions execution path, must run
inside a task-local Bubblewrap namespace. The canonical `projectDir` is the
only writable bind from the Ploinky workspace; the namespace root and provider
runtime are read-only, while only the OpenCode configuration, cache, data, and
state directories needed for normal operation are mounted separately writable.
The wrapper must reject missing, external, or symlink-escaped project
directories, share networking for provider calls, filter loader/runtime
injection variables, all raw Ploinky agent/private/client/master credentials,
invocation/router credentials, and provider secrets, and fail closed if nested
Bubblewrap cannot start. Provider authentication for delegated work comes from
provider-owned persistent state or a separately specified scoped broker; the
configured Soul Gateway template does not authorize exposing
`PLOINKY_AGENT_API_KEY` to a delegated task.
Before probing Bubblewrap or mutating project/session state, the wrapper must
verify that outer `/proc/self` represents its current PID namespace. It probes
private proc first. After a private failure, it may bind the existing proc
filesystem read-only only when an in-sandbox guard proves dynamic self-process
data and denies access to the parent worker's environment, root, working
directory, and file descriptors; task input and environment cannot choose the
mode or replace `/usr/bin/bwrap`.
Project authorization occurs before directory creation, missing components are
created without following symlinks, and the final real path is revalidated.
Capability failure is structured with status `422` and code
`PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE`; the launcher surfaces only allowlisted
safe lifecycle codes and never command lines, environment, credentials, or
hidden routing state. Execution remains unbounded until completion or
cancellation, while retained output and diagnostics are byte bounded.
Container profiles must allow nested user/mount namespaces. The installer must
reuse an existing `bwrap` binary in a Ploinky host sandbox, install Bubblewrap
when it is absent in a container, and readiness must execute both the nested
sandbox guard and `opencode --version` through the selected sandbox rather
than checking only for the binary.

The installed OpenCode config must add an OpenAI-compatible provider named
`soul-gateway`. Its base URL must be derived from `PLOINKY_ROUTER_URL`, and its
API key must reference Ploinky's generated `PLOINKY_AGENT_API_KEY` through
OpenCode environment substitution; neither resolved value may be written into
the repository template. That reference supports explicitly authorized
non-delegated runtime paths only; delegated Bubblewrap tasks do not inherit the
raw key. The provider must expose `fast`, `deep`, and `plan`
as `soul-gateway/fast`, `soul-gateway/deep`, and `soul-gateway/plan`. The config
must not set `model` or `small_model`, must not allowlist providers, and must
therefore preserve OpenCode's existing recent-model selection and other
configured providers. Its global permission map must set `*` to `allow` and
override `external_directory` to `deny`.

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

The manifest endpoint commands and both MCP task commands must invoke `node`
through the runtime `PATH`. They must not assume `/usr/local/bin/node`, because
the container image and Ploinky's mounted Bubblewrap Node distribution expose
the compatible executable through different absolute paths.

The models handler must list OpenCode models through the OpenCode CLI and
return an OpenAI-style `object: "list"` response. Each returned model id must
remain the exact OpenCode model id, such as `opencode/gpt-5` or `xai/grok-4.3`.
Descriptors must include the standardized Soul Gateway fields for
`modelId`, `providerModelId`, display name, token pricing when available,
context and output limits when available, tool and vision capability flags, and
exactly the umbrella tag `coding-agent`. The tag represents the coding-agent
route without duplicating implied capabilities as `coding`, `agentic`, or
`tool-calling`. Free OpenCode models must use
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

### Question #2: Why is the model excluded from the public input?
Response: The launcher has one stable input contract: the plain task text.
Model selection belongs to `opencodeAgent`, so AchillesCLI does not translate
its generic session model into an OpenCode provider model or expose a second
launcher grammar.

### Question #3: Why does AchillesCLI detach async task polling?
Response: OpenCode tasks can run long enough that blocking the orchestrator
prevents an otherwise independent conversation from continuing. AgentServer
already owns task execution and bounded log tails, so AchillesCLI returns the
start acknowledgement while a generic observer follows the same task id over
the router-mediated authorization path in each launch mode.

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

### Question #6: Why is OpenCode started by the launcher instead of the manifest?
Response: OpenCode is optional for ordinary AchillesCLI sessions. Keeping it
out of the manifest breaks the recursive startup chain, while the launcher's
status-first Marketplace flow enables it in explicit global mode, preserves a
deterministic first invocation, and avoids sending `enable_agent` again after
the runtime is already available.

### Question #7: Why is the final answer present in both live output and the MCP result?
Response: OpenCode emits its formatted answer and activity through stdout.
Relaying that stream unchanged gives WebChat the same output as direct
non-interactive CLI execution. The wrapper separately exports the resolved
session and selects its last assistant text for the MCP result contract.
AchillesCLI sends that result as presentation metadata, and Ploinky uses it to
mark the identical range already in the raw log without appending it, so the
task item still contains only one visible copy and can style it independently.

### Question #9: Why is the initial OpenCode session resolved by title?
Response: Default formatted output preserves the provider's native live log
but does not expose the created session id. A random per-run title provides a
concurrency-safe lookup key for the separate session-list interface. Matching
the title together with the project directory avoids selecting another
workspace's session, while continuation still uses the exact stored session id.

### Question #8: Why is the OpenCode session hidden behind a Ploinky continuation handle?
Response: The session id is provider state, and resuming it also requires the
original project directory. Keeping both in the agent's persistent private
store avoids placing filesystem authority in WebChat task data. The router
invokes only the stored target and continuation tool after normal user and MCP
policy checks, while the UUID handle remains generic across providers.

### Question #10: Why does continuation read OpenCode model state internally?
Response: The task page is a provider-neutral continuation surface and should
not expose an OpenCode-specific model argument. The OpenCode CLI and
`opencodeAgent` share the same persistent provider home, so the agent can read
the first recent model and its selected variant immediately before resuming.
Passing that selection explicitly overrides the older model stored on the
resumed session. Because this state file is an OpenCode implementation detail,
invalid or unavailable state preserves native resume behavior as a safe
compatibility fallback.

### Question #11: Why is Soul Gateway configured during the install hook?
Response: The profile install hook already runs before AgentServer in both the
container and host-sandbox startup paths. Installing the versioned template
immediately after the current OpenCode release avoids a dedicated image while
ensuring the MCP runner and interactive CLI read the same provider config from
their effective home. Ploinky injects the signed agent API key at runtime, so
the template contains only an environment reference and no credential.

### Question #12: Why does every OpenCode model use only `coding-agent`?
Response: The routed model executes through the OpenCode coding agent, so the
umbrella tag is the relevant functional category. Tool support, vision, limits,
and pricing remain structured descriptor fields and are not duplicated as
routing tags.

### Question #13: Why does the runner use `--auto` with an explicit external-directory denial?
Response: Non-interactive tasks must proceed without approval prompts while
preserving the configured denial. OpenCode auto mode approves only permission
requests that are not explicitly denied, whereas
`--dangerously-skip-permissions` bypasses the intended application-level
policy. This remains a useful application-level boundary, while the task-local
Bubblewrap wrapper supplies the independent operating-system filesystem
boundary.

### Question #14: Why is Bubblewrap started again when Ploinky already uses a container or `lite-sandbox`?
Response: The outer Ploinky boundary protects the host but can expose the whole
selected workspace to one agent instance. The inner namespace has a different
scope: it protects sibling projects from each individual task by making only
that task's canonical `projectDir` writable. A startup probe verifies this
nested namespace path for both outer runtime modes, and the agent remains
unready rather than silently running without per-task confinement.

## Conclusion
OpenCode delegation in AchillesCLI is a narrow provider launcher. It lets users
explicitly ask for OpenCode work while preserving Ploinky router mediation,
fixed tool dispatch, deterministic argument mapping, and plain text results.
Completed task results additionally carry an opaque continuation capability.
The same agent also provides an OpenAI-compatible provider surface for Soul
Gateway, with model discovery delegated to OpenCode and execution constrained
to the Ploinky-provided `WORKSPACE_PATH` plus the task-local Bubblewrap
filesystem boundary.
