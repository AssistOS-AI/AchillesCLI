---
id: DS013
title: Codex Launcher Delegation
status: active
owner: AchillesCLI Maintainers
summary: Defines resumable asynchronous delegation from AchillesCLI to the Codex Ploinky agent.
---

# DS013-codex-launcher-delegation

## Introduction

This DS defines the fixed Codex launcher and provider contract. It lets
AchillesCLI WebChat delegate a plain task to `codexAgent`, observe native Codex
output while the work runs, and continue the resulting provider thread without
exposing provider session data or adding Codex-specific fields to WebChat.

## Core Content

The `launch-codex` C-Skill accepts only non-empty natural-language task text.
Its target is fixed to `AchillesCLI/codexAgent`, and its MCP tool is fixed to
`execute-task`. It resolves `projectDir` from
`invocation.mainAgent.startDir`, sends only `prompt` and `projectDir`, and does
not parse JSON-shaped text or forward the AchillesCLI model. Explicit
`codex` or `codexAgent` requests are routed to this skill before generic
execution launchers.

The launcher uses the router-mediated `AgentMcpClient` path. It checks the
installed target's Marketplace state, requests global activation only when the
manual-start worker is not running, waits for readiness, and calls
`callToolWithoutWait`. It never calls a target container port directly. An
asynchronous task response returns `Task started.` and is handed to the
existing background-task observer.

`codexAgent.execute-task` and `codexAgent.continue-task` are asynchronous
five-minute MCP tools with full task-log retention. `execute-task` is tagged
`internal` for AchillesCLI agent-to-agent delegation and declares
`continue-task` as its continuation tool. `continue-task` keeps the default
authenticated access class because WebChat invokes later turns in the
authenticated user context.

Initial execution runs:

```text
codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox [--model <initial-override>] <prompt>
```

The command runs in the resolved project directory and must not use
`--ephemeral`, because a provider thread must survive the initial process.
An optional initial model remains available to direct internal MCP callers,
but `launch-codex` never sends it.

Codex stdout is JSONL control data. The wrapper parses it incrementally,
captures `thread.started.thread_id`, forwards completed agent-message text and
completed command-output text immediately to the AgentServer log stream, and
selects the last bounded agent message as final `outputText`. Codex stderr is
forwarded byte-for-byte. The visible stream must not add wrapper prefixes,
synthetic start/exit lines, raw JSON events, or a second copy of the structured
final result. Reasoning items remain outside the visible log.

After Codex reports a thread id, the provider stores it together with the
resolved original project directory in an agent-private record behind a random
UUID handle. The store rejects non-UUID handles and symlinked stores or
records, writes atomically, and uses restrictive directory and file modes.
The record must never contain the model, prompt, credentials, or Ploinky
authorization data. The structured result exposes only bounded answer text and
the generic versioned continuation descriptor.

Continuation accepts only the opaque handle and a new non-empty prompt. It
loads the provider thread and original directory, then runs:

```text
codex exec resume --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox <thread-id> <prompt>
```

The resumed command must not receive `--model`. This omission is deliberate:
the model configured when the continuation starts is authoritative, rather
than the model used by the initial turn. The same opaque handle is returned
after success. Ploinky creates a new remote AgentServer task for the turn while
keeping the stable local WebChat task id and incrementing its turn counter.

Both wrappers treat `SIGTERM` as controlled cancellation: they abort the Codex
subprocess and, when Codex already reported a thread id, persist it through the
same opaque handle and emit the structured continuation descriptor before
exiting unsuccessfully. AgentServer therefore records cancellation while
retaining the provider thread needed for a later turn on the same local task
id. A queued cancellation that never starts Codex has no thread and is not
continuable.

The provider remains `startup: manual` and absent from the AchillesCLI
manifest dependency graph. Direct operator use through
`ploinky cli codexAgent` remains supported independently of WebChat launcher
delegation.

## Decisions & Questions

### Question #1: Why does the continuation record omit the model?

Response:
Continuation must honor current user configuration. Persisting the initial
model would make old provider state override a later model choice and would
diverge from the provider-owned continuation behavior used by PI and OpenCode.

### Question #2: Why are only selected JSONL payloads visible?

Response:
Codex JSONL contains transport and lifecycle records that are useful to the
wrapper but are not native textual task output. Forwarding the textual agent
and completed command payloads preserves live provider output without exposing
control records or duplicating the final structured result.

### Question #3: Why is the bypass flag permitted?

Response:
The Codex process runs non-interactively inside the separately isolated
Ploinky agent runtime. WebChat cannot answer CLI approval prompts, so the
provider uses Codex's explicit automation flag and keeps the worker behind the
router and MCP policy boundary.

## Conclusion

Codex delegation is a fixed, router-mediated, resumable provider capability.
It preserves live output, current-model continuation semantics, opaque provider
state, manual worker startup, and the generic WebChat task contract.
