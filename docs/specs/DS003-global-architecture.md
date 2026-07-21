---
id: DS003
title: Global Architecture
status: active
owner: AchillesCLI Maintainers
summary: Defines the top-level runtime architecture, execution planes, and cross-module invariants.
---

# DS003-global-architecture

## Introduction
This DS defines AchillesCLI global architecture. It captures the stable runtime shape and the boundaries between bootstrapping, command handling, UI, schemas, and skills.

## Core Content
Global runtime layers:
1. Trusted broker entry layer (`src/cli.mjs`, `src/broker/`) resolves the session workspace, owns Bash permission state, and starts the agent process inside Bubblewrap.
2. Sandboxed entry layer (`src/index.mjs`) initializes the agent runtime, resolves dependencies, parses CLI flags, and chooses execution mode.
3. Execution layer (`MainAgent`, `LLMAgent`) performs skill discovery and prompt execution inside the session sandbox.
4. Interaction layer (`src/repl/`) coordinates command input, slash commands, natural language execution, and session state.
5. Presentation layer (`src/ui/`) provides selectors, editor UX, spinner, markdown rendering, help surfaces, and UI providers.
6. Skill contract layer (`src/schemas/`, `src/skills/`) validates skill definitions and executes built-in tool behaviors.

Execution planes:
1. Deterministic plane:
   - Slash commands route directly to specific skills or command handlers.
   - File-oriented operations remain explicit and predictable.
2. Orchestrated plane:
   - Natural-language prompts run through orchestrator skills and LLM routing.
   - Planner/executor flows may invoke multiple subordinate skills.

Skill root model:
1. Built-in skill roots are bundled with AchillesCLI.
2. Optional external roots can be supplied through CLI args.
3. Additional roots can be discovered under local `node_modules`.
4. Root precedence and registration order must remain deterministic.

Configuration invariants:
1. Runtime config supports manual overrides and environment-derived defaults.
2. Dependency resolution supports explicit path override, parent-path lookup, and `node_modules` fallback.
3. Missing required runtime dependencies must fail with explicit guidance.

State and lifecycle invariants:
1. Session-local runtime state (history, tier/model, working paths) is managed by REPL runtime.
2. Skill catalog refresh (`reloadSkills`) must preserve runtime consistency after write/delete operations.
3. Cancellation paths (for interactive execution) must leave terminal state recoverable.
4. The workspace resolved at broker startup is fixed for the session and is the only writable filesystem tree exposed automatically to MainAgent.
5. Network access remains shared with the host runtime; this boundary confines filesystem access only.

Bash security boundary:
1. Only the Bash skill is permission-gated; all other skills execute normally inside the persistent MainAgent sandbox.
2. `ask-for-approval` requires `allow`, `deny`, or `always allow` before Bash execution outside the workspace sandbox.
3. `full-access` means automatic Bash access inside the current workspace, not unrestricted host filesystem access.
4. A likely sandbox denial may be retried outside Bubblewrap only after an exact-call approval.
5. The trusted broker validates opaque approval proofs against the exact `toolName + params` combination.
6. The sandboxed process cannot change permission mode or resolve a pending user approval without the one-time trusted CLI control capability consumed during bootstrap.
7. A WebChat approval suspends the original broker request and is represented by a structured interaction envelope; it must not be rendered or persisted as conversation text.
8. Only a decision carrying the matching interaction identifier may settle the pending broker request, and the first valid decision wins.
9. After an approved command completes, the executor must return captured stdout and stderr only through the Broker response. The Bash skill must pass the ordinary command output or execution error into the agentic session, while process stdout/stderr remain reserved for user-facing agent output and structured WebChat control envelopes.
10. When the user denies a pre-execution Bash request, AchillesAgentLib must skip the Bash handler, store the exact tool name, exact parameters, and human-readable denial reason as an ordinary tool result, and continue planning without exposing protocol JSON or retrying the same command in that turn.

Communication prompt invariants:
1. The AchillesCLI orchestrator system prompt must prefer user-facing responses that are short and to the point while preserving enough content to answer the request correctly.
2. The orchestrator system prompt must not prefer one-word responses as a general optimization rule.
3. User-facing brevity guidance must remain subordinate to the structured planner decision contract enforced by AchillesAgentLib.

## Decisions & Questions

### Question #1: Why does the communication policy avoid preferring one-word answers?

Response:
A one-word preference can remove context required for a useful answer and can interfere with an enclosing planner contract. Describing concise, direct responses as preferable preserves the intended user experience without turning minimum length into a higher-priority output rule.

### Question #2: Why does the trusted broker remain outside the persistent MainAgent sandbox?

Response:
An approval must permit one exact command to run with broader filesystem visibility without widening MainAgent or every later tool call. Keeping the broker outside Bubblewrap lets it validate an opaque exact-call proof and launch that one process while the long-lived agent sandbox remains unchanged.

### Question #3: Why does WebChat approval suspend the original broker request?

Response:
The command result belongs to the tool call that requested it. Holding that request open lets `allow`, `deny`, and `always allow` return through the same execution path without turning a control decision into a new conversation message or asking the planner to reconstruct a previous turn.

## Conclusion
AchillesCLI architecture remains a layered CLI system where deterministic command execution and LLM orchestration coexist under a single runtime contract.
