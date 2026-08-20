---
title: DS002-llm-model-strategy
summary: Defines mandatory LLM routing, tier semantics, and persisted workspace model selection.
---

## Introduction
AchillesCLI executes both deterministic commands and LLM-mediated orchestration. This DS defines the mandatory model-routing strategy and the operational controls exposed by the runtime.

## Core Content
The LLM execution path is anchored on AchillesAgentLib:
`MainAgent` manages prompt execution and skill routing.

`LLMAgent` is the only authorized model invocation abstraction.

Provider/model/tier behavior is configured through runtime configuration and environment variables.

Tier semantics:
`fast` is optimized for low-latency interactions and short operations.

`standard` is the default balanced tier for general CLI work.

`premium` is reserved for heavier reasoning or high-fidelity generation paths.

Runtime controls:
`/tier` updates the session tier preference and removes any persisted explicit model selection.

`/model <model-name>` selects one exact Soul Gateway model. There is no `/model clear` command.

The selected model is stored in `<workspace>/.achilles-cli/settings.json`, restored by later terminal and WebChat runtimes for that workspace, and reflected in prompt, skill, and startup-intro LLM requests.

A WebChat runtime must publish the explicit settings model through the generic `__webchatRuntimeState` stdout envelope at startup and after `/model` or `/tier` changes. It must publish `null` when no explicit model exists. This state describes the configured model only; it does not claim to identify the effective Soul Gateway leaf model for an individual response.

Model selection behavior:
Runtime configuration may provide provider defaults and tier maps.

Manual configuration overrides are applied before environment-derived defaults.

Missing mandatory model/provider details must produce explicit errors.

Selectable model names are loaded from the authenticated local Soul Gateway `GET /base-agent-additional-server/soul-gateway/7000/v1/models` route. AchillesCLI uses its generated Ploinky agent identity and must not expose that credential to WebChat.

Model aliases reported only as Soul Gateway compatibility aliases are excluded, while direct models and named cascades remain selectable.

The current hosted Soul Gateway fallback through an explicit `SOUL_GATEWAY_API_KEY` is temporary and not canonical AchillesCLI model strategy. It exists only for the migration period in which `soul.axiologic.dev` is still required; the canonical future path is AchillesAgentLib using generated Ploinky credentials against the local Soul Gateway deployment.

AchillesCLI must decorate AchillesAgentLib's standard invoker with the explicit `soul_gateway` provider key for every LLM call while preserving the requested model identifier byte-for-byte.

An explicitly selected model must not require a matching entry in AchillesAgentLib's process-local model snapshot before it can be forwarded. Soul Gateway remains responsible for validating model existence, routing, and caller authorization.

The decorated invoker must preserve the standard invoker's supported-model, catalog, last-invocation, and description helpers so existing AchillesAgentLib introspection behavior remains available.

Task metadata requirements:
Routing-sensitive operations must carry explicit tags.

Baseline tags remain: `documentation`, `specification`, `orchestration`, `bootstrap`, `testing`.

New tags may be added only without breaking baseline tag handling.

Safety and visibility:
Debug logging may expose routing details only in debug mode.

User-facing responses in normal mode must avoid leaking internal prompts, stack traces, and credentials.

### Rationale and Boundaries

AchillesCLI currently needs to run from Explorer workspaces whose nearest parent `.env` may carry a hosted `SOUL_GATEWAY_API_KEY`. Letting that explicit key configure the initial LLM provider keeps startup working during the migration window, but it is not the canonical model-routing rule. DS010 records the exact manifest offset for this temporary agent-level opt-in.

Soul Gateway can expose hundreds of direct models and cascades, but the minimal credential-free catalog remains small enough to search locally. AchillesCLI returns it once, ordered with the current selection and common cascades first. The generic WebChat autocomplete keeps every matching model selectable while progressively adding bounded DOM batches behind a fixed-height scrollable viewport, avoiding both per-keystroke network requests and a single large render.

The header is a view of the current workspace configuration. AchillesCLI can read that value deterministically before any request and immediately after a slash-command change, while an effective cascade leaf belongs to one provider response and may differ between internal calls. Publishing the persisted selection keeps the UI useful without introducing per-message model metadata or requiring WebChat to understand Soul Gateway routing.

The selectable catalog is a user-interface and automatic-selection aid, not a client-side model allowlist. Agent-backed model identifiers may contain repository, agent, provider, and model segments and may appear after an AchillesCLI process has initialized its local catalog snapshot. Supplying `providerKey: soul_gateway` at the central invoker boundary lets AchillesAgentLib select the transport adapter, base URL, and credential while forwarding the opaque model identifier unchanged. Soul Gateway then applies its current catalog and authorization policy without requiring WebChat refreshes or AchillesCLI process restarts.
