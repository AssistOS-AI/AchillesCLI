---
title: DS011-aku-aware-copilot-memory
summary: Defines how AchillesCLI resolves, reads, updates, and supplies Agentic Knowledge Units during prompt execution.
---

## Introduction

This DS owns AchillesCLI policy for Agentic Knowledge Units (AKU). AchillesAgentLib owns the storage schema and public AKU APIs; Ploinky and WebChat remain generic transports with no knowledge of KU internals.

## Core Content

AchillesCLI may prepare AKU context when a prompt refers to durable work, prior results, scoped project knowledge, or reusable findings. A missing `<workspace>/.data/achilles-cli/aku/` persistence root must not block ordinary prompts and must be initialized only when the requested work needs durable AKU state.

| Phase | AchillesCLI responsibility |
| --- | --- |
| Resolve | Use prompt terms, active folder scope, session hints, tags, links, and AKU search results to identify candidate KUs. |
| Prepare | Build a compact ContextPack through public AKU APIs and keep retrieved memory separate from new user instructions. |
| Execute | Give the selected context to the normal skill-aware prompt path without exposing storage internals. |
| Persist | Record only durable outcomes such as state changes, events, documents, files, results, validations, or reusable findings through AKU APIs. |

The active folder-scoped KU is the strongest default scope. AchillesCLI may use names, types, keywords, tags, summaries, links, result titles, and document titles to resolve natural-language references. A read-only request may show plausible candidates, but an ambiguous high-impact mutation must request disambiguation before changing a KU.

`ku_type` is an open string. AchillesCLI may apply defaults for common types, but an unknown or user-defined type must follow the same generic lifecycle and must not be rejected only because it is absent from a recommended catalog. One prompt may create or update several related KUs; their relationships must use generic AKU links rather than prompt-specific schema fields.

ContextPacks should begin with compact indexed content and include deeper state, documents, results, or history only when the task requires them. Selection metadata should remain sufficient to explain why a KU was included. Full ContextPacks, raw storage files, hidden prompts, chain-of-thought, credentials, and sensitive file contents must not be copied into user output or durable memory.

After execution, AchillesCLI should persist the durable consequence rather than the complete conversation. Failures that remain useful may become a failure note or type-appropriate result. Rejected work should use AKU status or discard operations instead of filesystem deletion by default.

Provider-result caching may use AKU only when a launcher declares its result cacheable. An exact hit must match backend, working directory, normalized prompt hash, and an unexpired lifetime. A conservative similar-prompt hit must additionally match an agent-result cache record and sufficient prompt terms; lexical search must not be described as vector similarity. Execution results from providers marked non-cacheable must run again.

All access must use the public `AgenticKnowledgeUnits` interface and provide `<workspace>/.data/achilles-cli/aku/` as its explicit persistence root. AchillesCLI must not read, write, or infer the library's private persistence layout. Generic WebChat folder, attachment, and path hints may help resolution after workspace validation, but they must never create or mutate a KU without AchillesCLI interpreting a user request.
