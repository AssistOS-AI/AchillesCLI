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

Every OpenCode execution path, including session discovery, export, initial
execution, continuation, chat completions, model helpers, login/control, and
interactive CLI, must run through the canonical provider Bubblewrap policy.
The provider receives the sanitized `/workspace` tree read-only and only the
exact selected `projectDir` subtree read-write; sibling projects remain
readable but reject writes. The mode-derived provider HOME is mounted
read-write at `/home/agent`, with the OpenCode executable/package roots
overlaid read-only. Ploinky control state, `.data`, other homes, engine storage,
sockets, and devices are masked or absent.

`projectDir` must already exist, be a directory below `/workspace`, and not be
the workspace root or a protected ancestor. The privileged
`ploinky-bwrap-launch` helper opens the workspace root once and resolves the
relative target with `openat2(2)` using
`RESOLVE_BENEATH|RESOLVE_NO_MAGICLINKS|RESOLVE_NO_SYMLINKS`. It retains the
workspace, workdir, HOME, and executable/package file descriptors and passes
them to Bubblewrap with `--ro-bind-fd`/`--bind-fd`; Bubblewrap never reopens a
security-sensitive source pathname. Missing directories are never created.
There is no `realpath`/metadata security decision, path-based fallback, or
fallback when `openat2`, required resolve flags, fd retention, or fd binding is
unavailable.

The namespace shares the selected service network for provider calls while
unsharing user, mount, PID, IPC, and UTS namespaces and mounting private proc.
Inherited proc is never admitted. Task input and environment cannot choose a
proc mode, helper, or Bubblewrap binary; JavaScript does not invoke a raw
Bubblewrap path. The environment is rebuilt from an explicit allowlist and
contains no service credential, reusable Router credential, master material,
or provider key. The trusted AgentServer creates a scoped Soul broker only
from its frozen `AgentCredentialContext`, and OpenCode receives only that
task/generation/audience-bound broker URL and short-lived token. Missing or
mismatched context fails before spawn; delegated work has no direct credential
or provider-owned authentication fallback.

Capability failure is structured with a stable status and policy code; the
launcher surfaces only allowlisted lifecycle codes and never command lines,
environment, credentials, or hidden routing state. Failure occurs before HOME
lease, broker, provider, project, or session mutation. Execution remains
unbounded until completion or cancellation, while retained output and
diagnostics are byte bounded.
Container profiles must allow nested user/mount namespaces. Both the Box and
the selected coding-container image must provide the compatible Bubblewrap and
fd-safe launcher ABI before the agent starts; the provider installer must never
install Bubblewrap at runtime. Readiness must execute the nested sandbox guard.
AgentServer readiness executes OpenCode only through the canonical
provider-readiness mode, with an empty tmpfs at `/workspace` and a private
`/workspace/readiness` working directory. It must not mount the real user
workspace, use `PLOINKY_WORKSPACE_ROOT`, invoke a raw Bubblewrap path, or fall
back to a direct OpenCode spawn.

During migration Phase 1, `readiness.sh` deliberately performs only immutable
image capability and installed-file checks and never launches OpenCode. This
interim safety gate removes the unsafe real-workspace probe but is not the
release readiness contract. Phase 6 must replace it with the empty-workspace
provider execution described above before the migration is accepted.

The `opencodeAgent` manifest is a dual-runtime declaration. It remains manual,
keeps `lite-sandbox: true`, and retains
`docker.io/assistos/ploinky-node:24-bookworm-tools`. True selects the mandatory
platform sandbox and ignores the dormant image declaration; changing only the
selector to false or removing it selects mandatory Podman and activates that
same container. A selected-runtime failure is fatal and never starts the other
runtime.

The installed OpenCode config must add an OpenAI-compatible provider named
`soul-gateway`. Its repository template contains no endpoint or credential;
each canonical provider launch supplies only the task-scoped broker URL and
short-lived token minted from the frozen trusted credential context. Absence
of that broker fails closed and never selects stored or direct provider
credentials. The provider must expose `fast`, `deep`, and `plan`
as `soul-gateway/fast`, `soul-gateway/deep`, and `soul-gateway/plan`. The config
must not set `model` or `small_model`. Its global permission map must set `*` to `allow` and
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
Response: Ploinky resolves `WORKSPACE_PATH` as the exact selected provider
workdir, not as the workspace root or an inferred current directory. The
canonical helper requires it to be an existing non-root directory below
`/workspace` and mounts that retained inode read-write over the read-only
workspace view. `PLOINKY_WORKSPACE_ROOT` identifies the policy root and is
therefore never a provider workdir.

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
resumed session. Because this state file is part of the current provider HOME
ABI, invalid or unavailable state rejects the continuation with a structured
state error; it is not interpreted through an older or cross-mode reader.

### Question #11: Why is Soul Gateway configured during the install hook?
Response: The profile install hook already runs before AgentServer in both the
container and host-sandbox startup paths. Installing the versioned template
immediately after the current OpenCode release avoids a dedicated image while
ensuring the MCP runner and interactive CLI read the same provider config from
their effective home. The template contains no reusable endpoint or credential;
each provider launch receives only the scoped broker URL and token minted from
the AgentServer's frozen credential context.

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
scope: it presents the workspace read-only and makes only the task's exact
fd-pinned `projectDir` writable, so sibling reads remain possible but sibling
writes fail. A startup probe verifies this nested namespace path for both outer
runtime modes, and the agent remains unready rather than silently running
without per-task confinement.

## Conclusion
OpenCode delegation in AchillesCLI is a narrow provider launcher. It lets users
explicitly ask for OpenCode work while preserving Ploinky router mediation,
fixed tool dispatch, deterministic argument mapping, and plain text results.
Completed task results additionally carry an opaque continuation capability.
The same agent also provides an OpenAI-compatible provider surface for Soul
Gateway, with model discovery delegated to OpenCode and execution constrained
to an existing non-root `WORKSPACE_PATH` through the canonical fd-pinned
Bubblewrap boundary and context-backed scoped broker.
