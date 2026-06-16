---
id: DS002
title: LLM Tier and Model Strategy
status: active
owner: AchillesCLI Maintainers
summary: Defines mandatory LLM routing, tier semantics, model selection, and session-level overrides.
---

# DS002-llm-model-strategy

## Introduction
AchillesCLI executes both deterministic commands and LLM-mediated orchestration. This DS defines the mandatory model-routing strategy and the operational controls exposed by the runtime.

## Core Content
The LLM execution path is anchored on AchillesAgentLib:
1. `MainAgent` manages prompt execution and skill routing.
2. `LLMAgent` is the only authorized model invocation abstraction.
3. Provider/model/tier behavior is configured through runtime configuration and environment variables.

Tier semantics:
1. `fast` is optimized for low-latency interactions and short operations.
2. `standard` is the default balanced tier for general CLI work.
3. `premium` is reserved for heavier reasoning or high-fidelity generation paths.

Session-level controls:
1. `/tier` updates or clears session tier preferences.
2. `/model` updates or clears pinned model names.
3. Session-selected tier/model must be reflected in subsequent LLM requests for that session.

Model selection behavior:
1. Runtime configuration may provide provider defaults and tier maps.
2. Manual configuration overrides are applied before environment-derived defaults.
3. Missing mandatory model/provider details must produce explicit errors.
4. The current hosted Soul Gateway fallback through an explicit `SOUL_GATEWAY_API_KEY` is temporary and not canonical AchillesCLI model strategy. It exists only for the migration period in which `soul.axiologic.dev` is still required; the canonical future path is AchillesAgentLib using generated Ploinky credentials against the local Soul Gateway deployment.

Task metadata requirements:
1. Routing-sensitive operations must carry explicit tags.
2. Baseline tags remain: `documentation`, `specification`, `orchestration`, `bootstrap`, `testing`.
3. New tags may be added only without breaking baseline tag handling.

Safety and visibility:
1. Debug logging may expose routing details only in debug mode.
2. User-facing responses in normal mode must avoid leaking internal prompts, stack traces, and credentials.

## Decisions & Questions

### Question #1: Why is hosted Soul Gateway fallback allowed for now?

Response:
AchillesCLI currently needs to run from Explorer workspaces whose nearest parent `.env` may carry a hosted `SOUL_GATEWAY_API_KEY`. Letting that explicit key configure the initial LLM provider keeps startup working during the migration window, but it is not the canonical model-routing rule. DS010 records the exact manifest offset for this temporary agent-level opt-in.

## Conclusion
All LLM execution in AchillesCLI must remain centralized through `LLMAgent`, governed by explicit tier/model policy, and controllable through session-aware runtime commands.
