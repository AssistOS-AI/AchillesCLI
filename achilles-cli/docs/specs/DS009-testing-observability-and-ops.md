---
title: DS009-testing-observability-and-ops
summary: Defines verification surfaces, operational diagnostics, error visibility, progress, and cancellation guarantees.
---

## Introduction

This DS owns how AchillesCLI verifies behavior and reports runtime health. It does not enumerate every test case or restate the functional contract tested by another DS.

## Core Content

| Area | Contract |
| --- | --- |
| Repository tests | `tests/` verifies cross-package behavior and integration boundaries. |
| Package tests | `achilles-cli/tests/` verifies CLI, broker, REPL, state, task, skill, and UI behavior. |
| Discovery | `src/lib/testDiscovery/` must expose only runnable supported test targets. |
| Logging | `Logger.mjs` must gate internal detail behind debug mode and keep normal output user-safe. |
| Metrics and context | `MetricsCollector.mjs` and `RequestContext.mjs` may attach bounded operational data without changing results. |
| Errors | Structured errors must preserve useful causes while preventing credentials, private prompts, and arbitrary host paths from reaching users. |

Tests must cover the observable contract at its owning boundary. High-risk coverage must include workspace confinement, Bash approval, persisted settings, conversation restoration, skill enablement, detached-task lifecycle, continuation, cancellation, unsafe path rejection, and recovery after failed WebChat turns. Provider-specific behavior belongs in the provider agent's tests rather than being duplicated in AchillesCLI.

Normal terminal, single-shot, and WebChat execution should expose the same concise error meaning. WebChat may add an authenticated workspace-file link only for a source frame mapped to a known AchillesCLI, AchillesAgentLib, or bundled Ploinky runtime root. Raw container paths and provider diagnostics must remain hidden.

Long-running operations should publish progress through the active UI or structured WebChat progress envelope. Progress, runtime state, and task protocol records are control metadata, not assistant answers. Child-process stdout and stderr must enter the bounded tool or task result that owns them instead of leaking onto unrelated process output.

Cancellation must stop the active operation, preserve any provider continuation state already returned, and leave the next prompt usable. Startup security failures must fail closed with a stable explanation. Test and generation helpers must fail when prerequisites are missing and must never convert an unexecuted check into a successful result.
