---
title: DS014-global-architecture
summary: Defines the top-level runtime architecture, execution planes, and cross-module invariants.
---

## Introduction
This DS defines AchillesCLI global architecture. It captures the stable runtime shape and the boundaries between bootstrapping, command handling, UI, schemas, and skills.

## Core Content
Global runtime layers:
Trusted broker entry layer (`src/cli.mjs`, `src/broker/`) resolves the session workspace, owns Bash permission state, and starts the agent process inside Bubblewrap.

Sandboxed entry layer (`src/index.mjs`) initializes the agent runtime, resolves dependencies, parses CLI flags, and chooses execution mode.

Execution layer (`MainAgent`, `LLMAgent`) performs skill discovery and prompt execution inside the session sandbox.

Interaction layer (`src/repl/`) coordinates command input, slash commands, natural language execution, and session state.

Presentation layer (`src/ui/`) provides selectors, editor UX, spinner, markdown rendering, help surfaces, and UI providers.

Skill contract layer (`src/schemas/`, `src/skills/`) validates skill definitions and executes built-in tool behaviors.

Execution planes:
### Deterministic plane
Slash commands route directly to specific skills or command handlers.

File-oriented operations remain explicit and predictable.

### Orchestrated plane
Natural-language prompts run through orchestrator skills and LLM routing.

Planner/executor flows may invoke multiple subordinate skills.

Skill root model:
Built-in skill roots are bundled with AchillesCLI.

Optional external roots can be supplied through CLI args.

Additional roots can be discovered under local `node_modules`.

Root precedence and registration order must remain deterministic.

Configuration invariants:
Runtime config supports manual overrides and environment-derived defaults.

Dependency resolution supports explicit path override, parent-path lookup, and `node_modules` fallback.

Missing required runtime dependencies must fail with explicit guidance.

State and lifecycle invariants:
Runtime state is split between MainAgent-local state (tier, working paths, and reusable exact-call approvals) and workspace-owned durable state. Durable state includes explicit model, Bash permission mode, and `currentSessionId` in `.achilles-cli/settings.json`, plus conversation records under `.achilles-cli/sessions/`.

Skill catalog refresh (`reloadSkills`) must preserve runtime consistency after write/delete operations.

Cancellation paths (for interactive execution) must leave terminal state recoverable.

The workspace resolved at broker startup is fixed for the session and is the only writable filesystem tree exposed automatically to MainAgent.

Network access remains shared with the host runtime; this boundary confines filesystem access only.

Bash security boundary:
Only the Bash skill is permission-gated; all other skills execute normally inside the persistent MainAgent sandbox.

`ask-for-approval` requires `allow`, `deny`, or `always allow` before Bash execution inside the workspace sandbox.

`full-access` means automatic Bash access inside the current workspace, not unrestricted host filesystem access.

Bash commands are never retried outside Bubblewrap; sandbox denials remain ordinary tool results.

AchillesAgentLib stores `always allow` only in MainAgent session memory under the exact `toolName + params` key; the broker stores no reusable command approvals.

The sandboxed process cannot change permission mode or resolve a pending user approval without the one-time trusted CLI control capability consumed during bootstrap.

A WebChat approval suspends the original broker request and is represented by a structured interaction envelope; it must not be rendered or persisted as conversation text.

Only a decision carrying the matching interaction identifier may settle the pending broker request, and the first valid decision wins.

The local Bash executor must run inside the persistent MainAgent sandbox, start the requested executable directly as a child process, and return captured stdout and stderr only to the Bash skill. Process stdout/stderr remain reserved for user-facing agent output and structured WebChat control envelopes.

When the user denies a pre-execution Bash request, AchillesAgentLib must skip the Bash handler, store the exact tool name, exact parameters, and human-readable denial reason as an ordinary tool result, and continue planning without exposing protocol JSON or retrying the same command in that turn.

The trusted broker must restore the workspace's persisted Bash permission mode before MainAgent starts. A missing or invalid value must resolve to `ask-for-approval`.

Persisting `full-access` does not widen the filesystem boundary: automatic Bash execution remains confined to the current workspace and no outside retry exists.

Communication prompt invariants:
The AchillesCLI orchestrator system prompt must prefer user-facing responses that are short and to the point while preserving enough content to answer the request correctly.

The orchestrator system prompt must not prefer one-word responses as a general optimization rule.

User-facing brevity guidance must remain subordinate to the structured planner decision contract enforced by AchillesAgentLib.

### Rationale and Boundaries

A one-word preference can remove context required for a useful answer and can interfere with an enclosing planner contract. Describing concise, direct responses as preferable preserves the intended user experience without turning minimum length into a higher-priority output rule.

The broker owns trusted permission state without exposing that authority to MainAgent, but it does not expose Bash execution or store reusable approvals. The local executor runs inside MainAgent and its child processes inherit the persistent Bubblewrap namespace. Keeping authorization outside also preserves a clean extension point for a future explicit escalation protocol.

The command result belongs to the tool call that requested it. Holding that request open lets `allow`, `deny`, and `always allow` return through the same execution path without turning a control decision into a new conversation message or asking the planner to reconstruct a previous turn.
