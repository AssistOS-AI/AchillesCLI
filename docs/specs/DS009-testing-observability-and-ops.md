---
id: DS009
title: Testing, Observability, and Operational Controls
status: active
owner: AchillesCLI Maintainers
summary: Defines test surfaces, logging behavior, metrics hooks, and operational runtime controls.
---

# DS009-testing-observability-and-ops

## Introduction
This DS defines verification and operational visibility surfaces for AchillesCLI, including test entry points and runtime observability modules.

## Core Content
Testing surfaces:
1. Repository tests are under `tests/`.
2. Package-local tests and scripts are under `achilles-cli/tests/` and `achilles-cli/scripts/`.
3. Test discovery utilities under `src/lib/testDiscovery/` define runnable test selection behavior.

Observability components:
1. `src/lib/Logger.mjs` provides runtime logging controls.
2. `src/lib/MetricsCollector.mjs` tracks runtime metrics/events where configured.
3. `src/lib/RequestContext.mjs` carries request-scoped runtime context.
4. `src/lib/errorHandling.mjs` and `src/lib/errorTypes.mjs` define structured error behavior.

Operational controls:
1. Debug mode enables deeper internal diagnostics.
2. Normal mode must keep outputs user-safe and concise.
3. Runtime command handlers (`/help`, `/debug`, `/tier`, `/model`, `/permissions`, `/reload`, `/version`, `/status`, `/tasks`) provide explicit operational control points.
4. ESC interruption is an operational control for long-running LLM and skill-execution flows.
5. `/tasks` provides bounded workspace-local task diagnostics. It must suppress live log tails for ongoing tasks, strip terminal control sequences, and reject symlinked task storage or log files.
6. A detached launcher must acknowledge the task with the generic text `Task started.`; the task module receives the target runtime id, task id, description, status, and log data from the generic task envelope.
7. WebChat runtime errors must preserve the user-safe error message and may expose the first mapped source frame as a Markdown link through Ploinky's authenticated `/workspace-files/` route. Source mapping is restricted to known AchillesCLI, AchillesAgentLib, and bundled Ploinky runtime roots; arbitrary absolute stack paths must not enter conversation output.
8. AchillesAgentLib errors must pass through without AchillesCLI reclassification. WebChat, the terminal REPL, and single-shot execution therefore show the same concise explanation, while only WebChat adds the mapped source link.
9. The local Bash executor must capture child stdout and stderr as bounded tool results and must not relay them through the AchillesCLI process streams.
10. Bubblewrap startup failures and broker protocol failures must be explicit and fail closed.

Reliability invariants:
1. Runtime failures should surface explicit diagnostics without leaking sensitive internals in non-debug output.
2. Long-running or multi-step flows should emit progress feedback through UI/ActionReporter paths.
3. Test and generation helpers must not silently pass when preconditions are missing.
4. Cancellation paths must leave the runtime in a recoverable state and avoid recording interrupted commands as successful history.

Cancellation test coverage requirements:
1. Natural-language interruption paths verify AbortSignal propagation and history suppression.
2. Agentic session interruption paths verify transition to `interrupted` and recovery on the next user prompt.
3. Slash-command execution paths verify cancellation propagation to runtime options.
4. Task-summary coverage must verify journal materialization, terminal-state non-regression, ordering, argument limits, terminal-only log tails, output bounds, and unsafe-path rejection.
5. Sandbox coverage must verify that the local Bash executor starts the requested command without a second Bubblewrap process, inherits MainAgent's namespace, writes inside the selected workspace, cannot read siblings, exposes no broker execution endpoint, performs no outside retry, and preserves approval controls, the empty-`/proc` fallback, and asynchronous Unix socket responses.
6. WebChat approval coverage must verify stable interaction identifiers, `always-allow` as the first and default option, suspension of the original broker request, all three decisions, stale-decision rejection, and suppression of raw approval JSON from user-visible tool failures.
7. Approved-command context coverage must verify that one-time and reusable approvals both return only the ordinary Bash output or error to the agentic session, without user-approval text, metadata, or direct writes of child stdout/stderr to the user-facing process streams.
8. Denied-command context coverage must verify that the Bash handler is never invoked, that the exact tool name, exact parameters, and denial reason receive a result reference visible to the next planner step, and that raw supervisor protocol fields do not become the final chat response.
9. Permission-settings coverage must verify per-workspace persistence beside the selected model, an unversioned stored object with cleanup of the legacy `version` property on write, safe fallback for missing or invalid values, restoration before Broker startup, explicit CLI override precedence without rewriting the saved value, Broker-first mutation, and best-effort Broker rollback after a settings write failure.

## Decisions & Questions

### Question #1: Why are ongoing logs excluded from `/tasks`?

Response:
The command is a bounded status snapshot rather than a second live-monitoring surface. WebChat already receives lifecycle updates through dedicated task envelopes, while terminal callers only need durable task state and bounded final diagnostics.

### Question #2: Why do WebChat errors link only mapped runtime sources?

Response:
The authenticated workspace-file route provides a useful path from an error to editable source without publishing raw container paths. Restricting links to known package and runtime roots keeps internal or provider-specific absolute paths out of persisted conversation history.

### Question #3: Why does AchillesCLI not wrap clarified AchillesAgentLib errors?

Response:
The library now distinguishes missing model text, invalid planner response shapes, provider status failures, and execution limits at their original source. Passing those errors through preserves the useful stack frame and keeps terminal and WebChat wording consistent; WebChat only adds the authenticated source link.

### Question #4: Why does a failed sandboxed Bash command not trigger an outside retry?

Response:
Bubblewrap propagates ordinary child-process failures and does not provide a semantic outside-workspace event. Treating a non-zero exit as proof that host access is required would be unsafe and would misclassify normal application errors. The current executor therefore returns every failure as an ordinary tool result and has no host-execution path.

## Conclusion
Testing and observability contracts ensure AchillesCLI remains maintainable, diagnosable, and operationally predictable as the runtime evolves.
