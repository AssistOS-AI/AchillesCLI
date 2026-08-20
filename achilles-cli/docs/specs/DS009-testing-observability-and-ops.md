---
title: DS009-testing-observability-and-ops
summary: Defines test surfaces, logging behavior, metrics hooks, and operational runtime controls.
---

## Introduction
This DS defines verification and operational visibility surfaces for AchillesCLI, including test entry points and runtime observability modules.

## Core Content
Testing surfaces:
Repository tests are under `tests/`.

Package-local tests and scripts are under `achilles-cli/tests/` and `achilles-cli/scripts/`.

Test discovery utilities under `src/lib/testDiscovery/` define runnable test selection behavior.

Observability components:
`src/lib/Logger.mjs` provides runtime logging controls.

`src/lib/MetricsCollector.mjs` tracks runtime metrics/events where configured.

`src/lib/RequestContext.mjs` carries request-scoped runtime context.

`src/lib/errorHandling.mjs` and `src/lib/errorTypes.mjs` define structured error behavior.

Operational controls:
Debug mode enables deeper internal diagnostics.

Normal mode must keep outputs user-safe and concise.

Runtime command handlers (`/help`, `/debug`, `/tier`, `/model`, `/permissions`, `/reload`, `/version`, `/status`, `/tasks`, `/task view`, `/task stop`, `/task continue`) provide explicit operational control points.

ESC interruption is an operational control for long-running LLM and skill-execution flows.

`/tasks` provides bounded workspace-local task diagnostics from `.achilles-cli/tasks/`. It must suppress live log tails for ongoing tasks, strip terminal control sequences, and reject symlinked task storage or log files.

A detached launcher must acknowledge the task with the generic text `Task started.`; the task module receives the target runtime id, task id, description, status, and log data from the generic task envelope.

WebChat runtime errors must preserve the user-safe error message and may expose the first mapped source frame as a Markdown link through Ploinky's authenticated `/workspace-files/` route. Source mapping is restricted to known AchillesCLI, AchillesAgentLib, and bundled Ploinky runtime roots; arbitrary absolute stack paths must not enter conversation output.

AchillesAgentLib errors must pass through without AchillesCLI reclassification. WebChat, the terminal REPL, and single-shot execution therefore show the same concise explanation, while only WebChat adds the mapped source link.

The local Bash executor must capture child stdout and stderr as bounded tool results and must not relay them through the AchillesCLI process streams.

Bubblewrap startup failures and broker protocol failures must be explicit and fail closed. A parent-namespace procfs mismatch must name the process id and `/proc/self` mismatch instead of surfacing Bubblewrap's lower-level namespace-open error.

Reliability invariants:
Runtime failures should surface explicit diagnostics without leaking sensitive internals in non-debug output.

Long-running or multi-step flows should emit progress feedback through UI/ActionReporter paths.

Test and generation helpers must not silently pass when preconditions are missing.

Cancellation paths must leave the runtime in a recoverable state and avoid recording interrupted commands as successful history.

Cancellation test coverage requirements:
Natural-language interruption paths verify AbortSignal propagation and history suppression.

Agentic session interruption paths verify transition to `interrupted` and recovery on the next user prompt.

Slash-command execution paths verify cancellation propagation to runtime options.

Task-summary coverage must verify journal materialization, terminal-state non-regression, ordering, argument limits, terminal-only log tails, output bounds, and unsafe-path rejection.

Sandbox coverage must verify that the local Bash executor starts the requested command without a second Bubblewrap process, inherits MainAgent's namespace, writes inside the selected workspace, cannot read siblings, exposes no broker execution endpoint, performs no outside retry, and preserves approval controls, the empty-`/proc` fallback, pre-sandbox procfs/PID-namespace consistency, and asynchronous Unix socket responses.

WebChat approval coverage must verify stable interaction identifiers, `always-allow` as the first and default option, suspension of the original broker request, all three decisions, stale-decision rejection, and suppression of raw approval JSON from user-visible tool failures.

Approved-command context coverage must verify that one-time and reusable approvals both return only the ordinary Bash output or error to the agentic session, without user-approval text, metadata, or direct writes of child stdout/stderr to the user-facing process streams.

Denied-command context coverage must verify that the Bash handler is never invoked, that the exact tool name, exact parameters, and denial reason receive a result reference visible to the next planner step, and that raw supervisor protocol fields do not become the final chat response.

Permission-settings coverage must verify per-workspace persistence beside the selected model, an unversioned stored object with cleanup of the legacy `version` property on write, safe fallback for missing or invalid values, restoration before Broker startup, explicit CLI override precedence without rewriting the saved value, Broker-first mutation, and best-effort Broker rollback after a settings write failure.

Skill-state coverage must verify default-enabled discovery, canonical disabled-name persistence, workspace path confinement, recursive directory targeting, session-tool refresh, WebChat envelope output, restoration after MainAgent replacement, exclusion from executable slash completions, and continued availability under `/skill enable`.

Task-management coverage must verify AchillesCLI-owned metadata and log persistence, preservation of `queued` as a remote status, action-specific autocomplete, exact remote cancellation, stable local ids across continuation turns, stale-turn rejection, and identical slash-command behavior in terminal and WebChat modes.

### Rationale and Boundaries

The command is a bounded status snapshot rather than a second live-monitoring surface. WebChat already receives lifecycle updates through dedicated task envelopes, while terminal callers only need durable task state and bounded final diagnostics.

The authenticated workspace-file route provides a useful path from an error to editable source without publishing raw container paths. Restricting links to known package and runtime roots keeps internal or provider-specific absolute paths out of persisted conversation history.

The library now distinguishes missing model text, invalid planner response shapes, provider status failures, and execution limits at their original source. Passing those errors through preserves the useful stack frame and keeps terminal and WebChat wording consistent; WebChat only adds the authenticated source link.

Bubblewrap propagates ordinary child-process failures and does not provide a semantic outside-workspace event. Treating a non-zero exit as proof that host access is required would be unsafe and would misclassify normal application errors. The current executor therefore returns every failure as an ordinary tool result and has no host-execution path.
