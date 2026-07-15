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
3. Runtime command handlers (`/help`, `/debug`, `/tier`, `/model`, `/reload`, `/version`, `/status`, `/tasks`) provide explicit operational control points.
4. ESC interruption is an operational control for long-running LLM and skill-execution flows.
5. `/tasks` provides bounded workspace-local task diagnostics. It must suppress live log tails for ongoing tasks, strip terminal control sequences, and reject symlinked task storage or log files.
6. A detached launcher must acknowledge the task with the generic text `Task started.`; the task module receives the target runtime id, task id, description, status, and log data from the generic task envelope.

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

## Decisions & Questions

### Question #1: Why are ongoing logs excluded from `/tasks`?

Response:
The command is a bounded status snapshot rather than a second live-monitoring surface. WebChat already receives lifecycle updates through dedicated task envelopes, while terminal callers only need durable task state and bounded final diagnostics.

## Conclusion
Testing and observability contracts ensure AchillesCLI remains maintainable, diagnosable, and operationally predictable as the runtime evolves.
