---
title: DS002-llm-model-strategy
summary: Defines LLM routing, tier behavior, model selection, and model-setting persistence.
---

## Introduction

AchillesCLI routes every language-model request through AchillesAgentLib and Soul Gateway. This DS owns model and tier selection only; command processing, WebChat presentation, and startup mechanics belong to their dedicated specifications.

## Core Content

`MainAgent` must use `LLMAgent` as the single model-invocation abstraction. AchillesCLI must decorate the standard invoker with the `soul_gateway` provider key, preserve the requested model identifier unchanged, and preserve the invoker's catalog and diagnostic helpers. Soul Gateway remains responsible for model validation, authorization, and final routing.

| Selection | Contract |
| --- | --- |
| `fast` | Favors short, low-latency work. |
| `standard` | Provides the default balanced tier. |
| `premium` | Supports work that needs heavier reasoning. |
| `/model <name>` | Selects an exact Soul Gateway model for the workspace. |
| `/tier` | Selects the session tier and removes an explicit workspace model. |

The explicit model must be stored under `model` in `<workspace>/.achilles-cli/settings.json` and restored in later processes. Prompt execution, skills, and startup-intro requests must observe that selection. A model identifier may be forwarded even when it is absent from an older process-local catalog snapshot.

Selectable names must come from the authenticated local Soul Gateway models route. Compatibility-only aliases must be excluded while direct models and named cascades remain available. AchillesCLI may order common choices for usability, but the returned catalog is not a client-side allowlist.

WebChat may receive only the persisted explicit selection through `__webchatRuntimeState`; it must receive `null` when no explicit model exists. Provider credentials, raw provider configuration, internal prompts, and the effective leaf chosen inside a cascade must not enter that envelope or normal user output.

An explicit hosted `SOUL_GATEWAY_API_KEY` may configure the migration fallback. Generated Ploinky identity and the local Soul Gateway route remain the canonical integration, and partial or missing mandatory routing configuration must fail explicitly.
