---
title: DS011-aku-aware-copilot-memory
summary: Defines how AchillesCLI Copilot uses the local AKU library to resolve, create, update, link, and retrieve Knowledge Units during prompt-driven work.
---

## Introduction
This DS defines the AchillesCLI contract for using Agentic Knowledge Units during Copilot-style prompt execution.

AKU itself remains a local deterministic AchillesAgentLib library. It does not interpret prompts, call LLMs, know about Copilot, or decide semantic memory boundaries. AchillesCLI owns the prompt-aware behavior: it interprets user intent, detects the relevant Knowledge Units from natural language and local context, chooses whether durable memory is needed, calls AKU APIs, and provides compact AKU context back into the agent loop.

## Core Content
Authority boundaries:
AchillesAgentLib `docs/specs/DS008-AgenticKnowledgeUnits.md` defines the AKU storage model, public API, search semantics, ContextPack behavior, locking, recovery, and data model.

This DS defines only AchillesCLI behavior around that library.

AchillesCLI must not edit `.aku` files directly. All AKU reads and writes must go through `AgenticKnowledgeUnits`.

AchillesCLI must not add Copilot-specific fields to the AKU schema unless AchillesAgentLib DS008 first defines them as generic AKU fields.

Prompt interpretation may use AchillesCLI's normal LLM orchestration, but AKU operations remain deterministic library calls.

Implementation invariants:
The only AchillesCLI component allowed to orchestrate AKU prompt preflight, memory action planning, and postflight persistence is the AchillesCLI AKU memory adapter.

The AKU memory adapter must use only the public `AgenticKnowledgeUnits` API. It must not read or write `.aku` files, KU manifests, indexes, lock files, or result files directly.

The AKU memory adapter belongs in AchillesCLI. It must not be implemented in Ploinky WebChat, Explorer, the AKU library, or generic prompt transport code.

Ploinky WebChat and Explorer may pass only generic launch information such as prompt text, working directory, folder hints, attachments, and workspace-path references. They must not validate, resolve, create, mutate, or display Knowledge Units as a domain concept.

The user-facing contract is natural language. KU ids are internal identifiers and may appear only in diagnostics, explicit debug output, or advanced user requests.

Preflight is read-oriented. It may call `exists()`, `loadAKU()`, `search()`, `buildContextPack()`, and `buildScopedContextPack()`. It must not create or mutate KUs merely because a folder scope hint exists.

Mutations require a concrete memory action inferred from the prompt or task result, such as creating durable work units, recording experiment results, updating a specification, preserving a finding, or changing a KU status.

A missing `.aku` folder is non-blocking for ordinary prompt execution. AchillesCLI may initialize AKU only when the prompt or selected workflow clearly requires durable AKU-backed memory.

AchillesCLI may populate only generic AKU model fields defined by DS008. New fields such as aliases, ordinals, or Copilot-specific labels require a DS008 data-model update before implementation.

AchillesCLI session state may remember inferred active KUs for continuity, but that state remains local to AchillesCLI and must not require Ploinky WebChat or Explorer to understand KUs.

AKU persistence must not store hidden chain-of-thought, raw private prompts, credentials, secrets, or sensitive file content.

Activation model:
AKU-aware behavior is part of Copilot prompt execution when the active working directory contains `.aku`, when an explicit launch/runtime option enables AKU memory, or when the prompt clearly asks to create or use durable work memory.

Opening Copilot from a folder provides a folder scope hint only. It does not by itself create a KU.

A prompt may trigger KU creation or updates when it asks for durable work such as creating a folder-scoped work item, launching experiments, recording results, updating a specification, preserving a finding, or retrieving prior KU results.

Ordinary one-off chat, explanation, or file inspection must not create KUs unless the user asks to preserve the work or the requested operation inherently creates durable outputs.

Users are not expected to know, type, or manage KU identifiers. KU ids may appear in diagnostics or internal records, but normal Copilot use is natural-language only.

Prompt preflight:
Before non-slash prompt execution, AchillesCLI should normalize the incoming prompt and runtime context into an AKU planning packet.

The packet should include the raw user text, working directory, folder scope hint, generic workspace-path references, previous AchillesCLI-resolved AKU session state when present, session id when available, and attachment metadata.

AchillesCLI should instantiate `AgenticKnowledgeUnits` with `rootDir` equal to the active working directory or the workspace root selected by the runtime.

If AKU exists, AchillesCLI should call `loadAKU()` and then search or build a scoped ContextPack from prompt terms and scope hints.

If AKU does not exist, AchillesCLI should only call `initAKU()` when the prompt asks for durable AKU-backed work. A missing `.aku` must not block normal non-memory prompts.

KU resolution policy:
AchillesCLI should infer candidate KUs from natural-language prompt content, recent session state, current folder scope, workspace-path references, and AKU search results.

The active folder-scoped parent KU from AchillesCLI's own resolved session state, if known, is the strongest scope signal.

Folder path matching should use AKU folder-scope records, not recursive filesystem scanning.

Free-text resolution should search AKU indexes with prompt keywords, tags, task nouns, target filenames, experiment labels, and result terms.

Ambiguous high-impact updates should ask the user before mutating an existing KU.

Ambiguous read-only retrieval may return the most relevant candidates and explain the match source.

Raw strings that happen to look like KU ids are not a primary user interface. AchillesCLI may use them as a search hint when present, but natural-language resolution remains the normal path.

Generic KU type handling:
AchillesCLI must treat folder-and-experiment prompts as examples of the generic KU lifecycle, not as special hardcoded workflows.

When a prompt implies durable work, AchillesCLI should identify the natural durable units in the prompt and assign each one an open-string `ku_type`.

The common recommended type catalog is owned by AchillesAgentLib DS008. AchillesCLI may use those common types, but it must also accept caller-defined or user-implied type strings without requiring DS008 to enumerate them first.

Type selection should be based on user language, task shape, expected outputs, and existing AKU matches. Common examples include specifications, scientific articles, internal documents, architecture decisions, research notes, data analyses, code work, validations, meeting outcomes, business analyses, grants or deliverables, reusable patterns, failure notes, and experiments; custom domain types are also valid.

Each KU type shares the same lifecycle: resolve existing candidates, decide read/create/update/fork/discard, call public AKU APIs, then update indexes through AKU.

Type-specific behavior may exist only as an AchillesCLI policy layer that maps known `ku_type` strings to default metadata, likely child records, and preferred AKU APIs. Unknown or custom type strings must fall back to generic KU behavior. The policy layer must not bypass AKU storage or add schema fields outside DS008.

A single prompt may create, read, or update multiple KUs of different types. Relations between them must use generic AKU link APIs and metadata rather than prompt-specific coupling.

If the durable unit is clear but its type materially affects persistence, AchillesCLI should ask for disambiguation. If the type does not materially affect the action, it may choose a clear common or custom type string and record explainable metadata.

Automatic creation and update policy:
AchillesCLI may automatically create KUs when the user prompt clearly defines new durable work units.

A request such as "create the folder folder1 and launch 3 experiments that test x, y and z" is a representative multi-KU example: it must produce one folder-scoped parent KU for `folder1` plus one experiment KU for each experiment.

The folder-scoped parent KU should use a clear open-string `ku_type`, register the folder scope, and link to the experiment KUs with `contains` links.

Each experiment KU should own its own state, run/result records, files, validations, reusable findings, and follow-up events.

The folder-scoped parent KU must not become a dumping ground for all experiment details.

The same creation rule applies to any `ku_type`: a prompt that asks for a specification, article, decision, analysis, validation, code work item, meeting outcome, business analysis, deliverable, reusable pattern, failure note, custom domain unit, or other durable unit should create or update that KU type through the same generic lifecycle.

If a prompt says to update an existing durable unit, AchillesCLI should resolve the target KU first, then call AKU update APIs on that KU.

If a prompt records a result, validation, document, important file, event, or reusable finding, AchillesCLI should prefer the matching AKU API over storing the information only in `state.md`.

Context injection:
AchillesCLI should provide AKU context to the orchestrated prompt as a compact ContextPack, not by opening every KU folder.

The default pack should use L1 search-index content. `state.md`, result details, documents, and history require explicit pack options or clear task need.

ContextPack content must be separated from user-authored prompt text so the agent can distinguish retrieved memory from new instructions.

The agent-facing prompt context should include enough `matched_on` or `why_included` data for the agent to justify why a KU was selected.

User-facing responses should not dump full ContextPacks unless the user asks for diagnostics.

When the Copilot detects candidate KUs, it should call `buildContextPack()` or `buildScopedContextPack()` before the main task execution and then call the specific AKU mutation APIs only after it has a concrete memory action to perform.

Postflight persistence:
After a memory-relevant turn, AchillesCLI should persist the durable consequences through AKU APIs.

Postflight records may include events, documents, registered files, results, validations, session summaries, and reusable findings.

AchillesCLI should not persist hidden chain-of-thought, raw private prompts, secrets, credentials, or sensitive file content into AKU.

If a turn fails in an informative way and the failure is useful later, AchillesCLI may create or update a `failure_note` or type-appropriate result/event with an explicit failure status.

If the user rejects or discards a result, AchillesCLI should use AKU status/discard APIs rather than deleting by default.

Provider result cache policy:
AchillesCLI may cache only pure-information provider results whose launcher output declares `cacheable: true`.

Open Interpreter execution results must never be automatic cache hits. The Open Interpreter launcher declares `cacheable: false`; repeated execution prompts must execute again.

Cache lookup and persistence belong to `AkuMemoryAdapter` methods such as `lookupCachedAgentResult()`, `persistAgentResult()`, and `recordAgentDurableOutcome()`. These methods must use only public `AgenticKnowledgeUnits` APIs such as `exists()`, `loadAKU()`, `search()`, `listResults()`, `initKU()`, and `recordResult()`.

Cache keys are represented through generic AKU metadata, tags, keywords, and result fields. AchillesCLI must not read or write `.aku` internals to implement provider caching.

Cache matching has two allowed paths. Exact cache hits require the same backend, same working directory, matching normalized prompt hash, and an unexpired TTL. Similar-prompt cache hits may come from AKU `search()` without a matching prompt hash only when the record is an agent-result cache entry for the same backend and working directory, the TTL is unexpired, and the prompt terms overlap conservatively enough for AchillesCLI to treat the hit as a paraphrase rather than a different question. Lexical AKU search results must not be treated as vector similarity.

Cache records and durable outcome records must not store secrets, invocation tokens, hidden reasoning, raw private prompts, credentials, or sensitive file content.

Retrieval behavior:
Scoped natural-language references should resolve within the active folder-scoped parent context first.

A request such as "get the results from experiment 1" is a representative retrieval example, not a special case.

The same retrieval policy applies to references such as "the architecture decision", "the validation report", "the article notes", "the reusable pattern", "the meeting outcome", or "the failed run" when those phrases can map to DS008 KU types or child records.

AchillesCLI should use KU names, KU types, keywords, tags, summaries, result titles, document titles, link relations, and folder-scope records to resolve user-facing labels.

If multiple matching KUs exist, AchillesCLI should prefer explicit active-scope links before global search recency.

Retrieved information should come from AKU records and relevant KU state through AKU APIs, not from ad hoc filesystem guessing.

If no confident match exists, AchillesCLI should show candidate KUs and ask for disambiguation before acting.

Explorer and WebChat integration:
Explorer's `Open Copilot here` action may pass a folder scope hint through generic WebChat launch parameters.

Ploinky WebChat should remain a generic transport for prompt text, working directory, attachments, and workspace-path references. It should not know about Knowledge Units or validate KU identifiers.

AchillesCLI owns interpretation of those generic hints and must preserve the boundary that folder launch alone is not KU creation.

Any generic envelope fields used as path or attachment inputs must be sanitized, workspace-confined where applicable, and ignored when invalid.

Testing obligations:
Unit tests must cover prompt preflight packet construction from plain text and generic WebChat envelopes.

Unit tests must cover generic classification and creation for multiple DS008 KU types, not only experiments.

Unit tests must cover "folder plus three experiments" creation using a temporary AKU root as a representative multi-KU regression fixture.

Unit tests must cover retrieval of "experiment 1 results" from an active folder-scoped parent KU as a representative scoped retrieval fixture.

Unit tests must prove ambiguous mutations ask for disambiguation instead of silently updating the wrong KU.

Integration tests should verify that Explorer/WebChat folder scope hints reach AchillesCLI without creating a KU by themselves.

### Rationale and Boundaries
The AKU data model is defined by AchillesAgentLib DS008 and implemented in `AgenticKnowledgeUnits/internal/schemas.mjs`, with search/index projections in `AgenticKnowledgeUnits/internal/indexing.mjs` and constants in `AgenticKnowledgeUnits/internal/constants.mjs`. AchillesCLI must treat those as the schema authority. This DS defines how AchillesCLI populates generic AKU fields such as `ku_name`, `ku_type`, `tags`, `keywords`, `summary`, `reusable_findings`, folder scopes, links, and results.

AKU is a deterministic local library. Prompt interpretation, user-facing Copilot behavior, and semantic decisions about what to create or update belong to AchillesCLI. Ploinky WebChat remains generic transport and should not know about KUs. Keeping those responsibilities in this DS prevents the shared AKU library and transport layers from depending on one host surface.

AchillesCLI should encode such labels through generic AKU metadata: `ku_name`, `keywords`, `tags`, summaries, result titles, and link summaries. If first-class `aliases` or `ordinal` fields become necessary, that change belongs first in AchillesAgentLib DS008 as a generic AKU data model refinement, then AchillesCLI can adopt it.

Automatic creation is allowed only when the prompt clearly defines durable work units or durable outputs. Creating a folder and launching named experiments is sufficient. Merely opening Copilot in a folder, asking a question, or inspecting a file is not sufficient.

The active KU inferred by AchillesCLI and any high-confidence natural-language matches should be included first. Link records may appear as lightweight hints. Linked target summaries should be opt-in or task-driven so sibling experiments do not swamp the current task context.

Experiments are one common KU type, and the folder-plus-experiments prompt is a useful regression example because it exercises multi-KU creation, scope registration, linking, result retrieval, and natural-language labels. The implementation must generalize the same lifecycle to every `ku_type`. AchillesCLI may maintain a type policy table for defaults and preferred AKU APIs, but the table must treat unknown or custom type strings with a generic fallback and must not become Copilot-specific schema.

DS008 defines `ku_type` as an open caller-defined string. The recommended catalog exists for interoperability and default policies, not validation. AchillesCLI must not reject or remap a clear custom type solely because it is absent from the recommended catalog.

A provider-result cache hit may reuse a similar prompt only as a conservative AKU search fallback after exact prompt-hash lookup misses. Similar-prompt reuse must keep the same backend, same working directory, unexpired TTL, and an agent-result-cache record marker. The adapter must still reject low-overlap or unrelated search results so a cached provider answer is not served for a materially different request.
