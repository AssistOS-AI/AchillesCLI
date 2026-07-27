---
id: DS002
title: LLM Tier and Model Strategy
status: active
owner: AchillesCLI Maintainers
summary: Defines mandatory LLM routing, tier semantics, and persisted workspace model selection.
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

Runtime controls:
1. `/tier` updates the session tier preference and removes any persisted explicit model selection.
2. `/model <model-name>` selects one exact Soul Gateway model. There is no `/model clear` command.
3. The selected model is stored in `<workspace>/.achilles-cli/settings.json`, restored by later terminal and WebChat runtimes for that workspace, and reflected in prompt, skill, and startup-intro LLM requests.
4. A WebChat runtime must publish the explicit settings model through the generic `__webchatRuntimeState` stdout envelope at startup and after `/model` or `/tier` changes. It must publish `null` when no explicit model exists. This state describes the configured model only; it does not claim to identify the effective Soul Gateway leaf model for an individual response.

Model selection behavior:
1. Runtime configuration may provide provider defaults and tier maps.
2. Manual configuration overrides are applied before environment-derived defaults.
3. Missing mandatory model/provider details must produce explicit errors.
4. Selectable model names are loaded from the authenticated local Soul Gateway `GET /base-agent-additional-server/soul-gateway/7000/v1/models` route. AchillesCLI uses its generated Ploinky agent identity and must not expose that credential to WebChat.
5. Model aliases reported only as Soul Gateway compatibility aliases are excluded, while direct models and named cascades remain selectable.
6. The current hosted Soul Gateway fallback through an explicit `SOUL_GATEWAY_API_KEY` is temporary and not canonical AchillesCLI model strategy. It exists only for the migration period in which `soul.axiologic.dev` is still required; the canonical future path is AchillesAgentLib using generated Ploinky credentials against the local Soul Gateway deployment.

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

### Question #2: Why does WebChat receive the complete model catalog instead of requesting pages from Soul Gateway?

Response:
Soul Gateway can expose hundreds of direct models and cascades, but the minimal credential-free catalog remains small enough to search locally. AchillesCLI returns it once, ordered with the current selection and common cascades first. The generic WebChat autocomplete keeps every matching model selectable while progressively adding bounded DOM batches behind a fixed-height scrollable viewport, avoiding both per-keystroke network requests and a single large render.

### Question #3: Why does AchillesCLI publish the settings model instead of Soul Gateway's effective response model?

Response:
The header is a view of the current workspace configuration. AchillesCLI can read that value deterministically before any request and immediately after a slash-command change, while an effective cascade leaf belongs to one provider response and may differ between internal calls. Publishing the persisted selection keeps the UI useful without introducing per-message model metadata or requiring WebChat to understand Soul Gateway routing.

## Conclusion
All LLM execution in AchillesCLI must remain centralized through `LLMAgent`, governed by explicit tier/model policy, and controllable through workspace-aware runtime commands.
