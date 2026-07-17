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
1. Entry layer (`src/index.mjs`) initializes the runtime, resolves dependencies, parses CLI flags, and chooses execution mode.
2. Execution layer (`MainAgent`, `LLMAgent`) performs skill discovery and prompt execution.
3. Interaction layer (`src/repl/`) coordinates command input, slash commands, natural language execution, and session state.
4. Presentation layer (`src/ui/`) provides selectors, editor UX, spinner, markdown rendering, help surfaces, and UI providers.
5. Skill contract layer (`src/schemas/`, `src/skills/`) validates skill definitions and executes built-in tool behaviors.

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

Communication prompt invariants:
1. The AchillesCLI orchestrator system prompt must prefer user-facing responses that are short and to the point while preserving enough content to answer the request correctly.
2. The orchestrator system prompt must not prefer one-word responses as a general optimization rule.
3. User-facing brevity guidance must remain subordinate to the structured planner decision contract enforced by AchillesAgentLib.

## Decisions & Questions

### Question #1: Why does the communication policy avoid preferring one-word answers?

Response:
A one-word preference can remove context required for a useful answer and can interfere with an enclosing planner contract. Describing concise, direct responses as preferable preserves the intended user experience without turning minimum length into a higher-priority output rule.

## Conclusion
AchillesCLI architecture remains a layered CLI system where deterministic command execution and LLM orchestration coexist under a single runtime contract.
