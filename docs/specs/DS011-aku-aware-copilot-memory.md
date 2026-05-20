---
id: DS011
title: AKU-Aware Copilot Memory
status: draft
owner: AchillesCLI Maintainers
summary: Defines how AchillesCLI Copilot uses the local AKU library to resolve, create, update, link, and retrieve Knowledge Units during prompt-driven work.
---

# DS011-aku-aware-copilot-memory

## Introduction
This DS defines the AchillesCLI contract for using Agentic Knowledge Units during Copilot-style prompt execution.

AKU itself remains a local deterministic AchillesAgentLib library. It does not interpret prompts, call LLMs, know about Copilot, or decide semantic memory boundaries. AchillesCLI owns the prompt-aware behavior: it interprets user intent, detects the relevant Knowledge Units from natural language and local context, chooses whether durable memory is needed, calls AKU APIs, and provides compact AKU context back into the agent loop.

## Core Content
Authority boundaries:
1. AchillesAgentLib `docs/specs/DS008-AgenticKnowledgeUnits.md` defines the AKU storage model, public API, search semantics, ContextPack behavior, locking, recovery, and data model.
2. This DS defines only AchillesCLI behavior around that library.
3. AchillesCLI must not edit `.aku` files directly. All AKU reads and writes must go through `AgenticKnowledgeUnits`.
4. AchillesCLI must not add Copilot-specific fields to the AKU schema unless AchillesAgentLib DS008 first defines them as generic AKU fields.
5. Prompt interpretation may use AchillesCLI's normal LLM orchestration, but AKU operations remain deterministic library calls.

Implementation invariants:
1. The only AchillesCLI component allowed to orchestrate AKU prompt preflight, memory action planning, and postflight persistence is the AchillesCLI AKU memory adapter.
2. The AKU memory adapter must use only the public `AgenticKnowledgeUnits` API. It must not read or write `.aku` files, KU manifests, indexes, lock files, or result files directly.
3. The AKU memory adapter belongs in AchillesCLI. It must not be implemented in Ploinky WebChat, Explorer, the AKU library, or generic prompt transport code.
4. Ploinky WebChat and Explorer may pass only generic launch information such as prompt text, working directory, folder hints, attachments, and workspace-path references. They must not validate, resolve, create, mutate, or display Knowledge Units as a domain concept.
5. The user-facing contract is natural language. KU ids are internal identifiers and may appear only in diagnostics, explicit debug output, or advanced user requests.
6. Preflight is read-oriented. It may call `exists()`, `loadAKU()`, `search()`, `buildContextPack()`, and `buildScopedContextPack()`. It must not create or mutate KUs merely because a folder scope hint exists.
7. Mutations require a concrete memory action inferred from the prompt or task result, such as creating durable work units, recording experiment results, updating a specification, preserving a finding, or changing a KU status.
8. A missing `.aku` folder is non-blocking for ordinary prompt execution. AchillesCLI may initialize AKU only when the prompt or selected workflow clearly requires durable AKU-backed memory.
9. AchillesCLI may populate only generic AKU model fields defined by DS008. New fields such as aliases, ordinals, or Copilot-specific labels require a DS008 data-model update before implementation.
10. AchillesCLI session state may remember inferred active KUs for continuity, but that state remains local to AchillesCLI and must not require Ploinky WebChat or Explorer to understand KUs.
11. AKU persistence must not store hidden chain-of-thought, raw private prompts, credentials, secrets, or sensitive file content.

Activation model:
1. AKU-aware behavior is part of Copilot prompt execution when the active working directory contains `.aku`, when an explicit launch/runtime option enables AKU memory, or when the prompt clearly asks to create or use durable work memory.
2. Opening Copilot from a folder provides a folder scope hint only. It does not by itself create a KU.
3. A prompt may trigger KU creation or updates when it asks for durable work such as creating a folder-scoped work item, launching experiments, recording results, updating a specification, preserving a finding, or retrieving prior KU results.
4. Ordinary one-off chat, explanation, or file inspection must not create KUs unless the user asks to preserve the work or the requested operation inherently creates durable outputs.
5. Users are not expected to know, type, or manage KU identifiers. KU ids may appear in diagnostics or internal records, but normal Copilot use is natural-language only.

Prompt preflight:
1. Before non-slash prompt execution, AchillesCLI should normalize the incoming prompt and runtime context into an AKU planning packet.
2. The packet should include the raw user text, working directory, folder scope hint, generic workspace-path references, previous AchillesCLI-resolved AKU session state when present, session id when available, and attachment metadata.
3. AchillesCLI should instantiate `AgenticKnowledgeUnits` with `rootDir` equal to the active working directory or the workspace root selected by the runtime.
4. If AKU exists, AchillesCLI should call `loadAKU()` and then search or build a scoped ContextPack from prompt terms and scope hints.
5. If AKU does not exist, AchillesCLI should only call `initAKU()` when the prompt asks for durable AKU-backed work. A missing `.aku` must not block normal non-memory prompts.

KU resolution policy:
1. AchillesCLI should infer candidate KUs from natural-language prompt content, recent session state, current folder scope, workspace-path references, and AKU search results.
2. The active folder-scoped parent KU from AchillesCLI's own resolved session state, if known, is the strongest scope signal.
3. Folder path matching should use AKU folder-scope records, not recursive filesystem scanning.
4. Free-text resolution should search AKU indexes with prompt keywords, tags, task nouns, target filenames, experiment labels, and result terms.
5. Ambiguous high-impact updates should ask the user before mutating an existing KU.
6. Ambiguous read-only retrieval may return the most relevant candidates and explain the match source.
7. Raw strings that happen to look like KU ids are not a primary user interface. AchillesCLI may use them as a search hint when present, but natural-language resolution remains the normal path.

Generic KU type handling:
1. AchillesCLI must treat folder-and-experiment prompts as examples of the generic KU lifecycle, not as special hardcoded workflows.
2. When a prompt implies durable work, AchillesCLI should identify the natural durable units in the prompt and assign each one an open-string `ku_type`.
3. The common recommended type catalog is owned by AchillesAgentLib DS008. AchillesCLI may use those common types, but it must also accept caller-defined or user-implied type strings without requiring DS008 to enumerate them first.
4. Type selection should be based on user language, task shape, expected outputs, and existing AKU matches. Common examples include specifications, scientific articles, internal documents, architecture decisions, research notes, data analyses, code work, validations, meeting outcomes, business analyses, grants or deliverables, reusable patterns, failure notes, and experiments; custom domain types are also valid.
5. Each KU type shares the same lifecycle: resolve existing candidates, decide read/create/update/fork/discard, call public AKU APIs, then update indexes through AKU.
6. Type-specific behavior may exist only as an AchillesCLI policy layer that maps known `ku_type` strings to default metadata, likely child records, and preferred AKU APIs. Unknown or custom type strings must fall back to generic KU behavior. The policy layer must not bypass AKU storage or add schema fields outside DS008.
7. A single prompt may create, read, or update multiple KUs of different types. Relations between them must use generic AKU link APIs and metadata rather than prompt-specific coupling.
8. If the durable unit is clear but its type materially affects persistence, AchillesCLI should ask for disambiguation. If the type does not materially affect the action, it may choose a clear common or custom type string and record explainable metadata.

Automatic creation and update policy:
1. AchillesCLI may automatically create KUs when the user prompt clearly defines new durable work units.
2. A request such as "create the folder folder1 and launch 3 experiments that test x, y and z" is a representative multi-KU example: it must produce one folder-scoped parent KU for `folder1` plus one experiment KU for each experiment.
3. The folder-scoped parent KU should use a clear open-string `ku_type`, register the folder scope, and link to the experiment KUs with `contains` links.
4. Each experiment KU should own its own state, run/result records, files, validations, reusable findings, and follow-up events.
5. The folder-scoped parent KU must not become a dumping ground for all experiment details.
6. The same creation rule applies to any `ku_type`: a prompt that asks for a specification, article, decision, analysis, validation, code work item, meeting outcome, business analysis, deliverable, reusable pattern, failure note, custom domain unit, or other durable unit should create or update that KU type through the same generic lifecycle.
7. If a prompt says to update an existing durable unit, AchillesCLI should resolve the target KU first, then call AKU update APIs on that KU.
8. If a prompt records a result, validation, document, important file, event, or reusable finding, AchillesCLI should prefer the matching AKU API over storing the information only in `state.md`.

Context injection:
1. AchillesCLI should provide AKU context to the orchestrated prompt as a compact ContextPack, not by opening every KU folder.
2. The default pack should use L1 search-index content. `state.md`, result details, documents, and history require explicit pack options or clear task need.
3. ContextPack content must be separated from user-authored prompt text so the agent can distinguish retrieved memory from new instructions.
4. The agent-facing prompt context should include enough `matched_on` or `why_included` data for the agent to justify why a KU was selected.
5. User-facing responses should not dump full ContextPacks unless the user asks for diagnostics.
6. When the Copilot detects candidate KUs, it should call `buildContextPack()` or `buildScopedContextPack()` before the main task execution and then call the specific AKU mutation APIs only after it has a concrete memory action to perform.

Postflight persistence:
1. After a memory-relevant turn, AchillesCLI should persist the durable consequences through AKU APIs.
2. Postflight records may include events, documents, registered files, results, validations, session summaries, and reusable findings.
3. AchillesCLI should not persist hidden chain-of-thought, raw private prompts, secrets, credentials, or sensitive file content into AKU.
4. If a turn fails in an informative way and the failure is useful later, AchillesCLI may create or update a `failure_note` or type-appropriate result/event with an explicit failure status.
5. If the user rejects or discards a result, AchillesCLI should use AKU status/discard APIs rather than deleting by default.

Retrieval behavior:
1. Scoped natural-language references should resolve within the active folder-scoped parent context first.
2. A request such as "get the results from experiment 1" is a representative retrieval example, not a special case.
3. The same retrieval policy applies to references such as "the architecture decision", "the validation report", "the article notes", "the reusable pattern", "the meeting outcome", or "the failed run" when those phrases can map to DS008 KU types or child records.
4. AchillesCLI should use KU names, KU types, keywords, tags, summaries, result titles, document titles, link relations, and folder-scope records to resolve user-facing labels.
5. If multiple matching KUs exist, AchillesCLI should prefer explicit active-scope links before global search recency.
6. Retrieved information should come from AKU records and relevant KU state through AKU APIs, not from ad hoc filesystem guessing.
7. If no confident match exists, AchillesCLI should show candidate KUs and ask for disambiguation before acting.

Explorer and WebChat integration:
1. Explorer's `Open Copilot here` action may pass a folder scope hint through generic WebChat launch parameters.
2. Ploinky WebChat should remain a generic transport for prompt text, working directory, attachments, and workspace-path references. It should not know about Knowledge Units or validate KU identifiers.
3. AchillesCLI owns interpretation of those generic hints and must preserve the boundary that folder launch alone is not KU creation.
4. Any generic envelope fields used as path or attachment inputs must be sanitized, workspace-confined where applicable, and ignored when invalid.

Testing obligations:
1. Unit tests must cover prompt preflight packet construction from plain text and generic WebChat envelopes.
2. Unit tests must cover generic classification and creation for multiple DS008 KU types, not only experiments.
3. Unit tests must cover "folder plus three experiments" creation using a temporary AKU root as a representative multi-KU regression fixture.
4. Unit tests must cover retrieval of "experiment 1 results" from an active folder-scoped parent KU as a representative scoped retrieval fixture.
5. Unit tests must prove ambiguous mutations ask for disambiguation instead of silently updating the wrong KU.
6. Integration tests should verify that Explorer/WebChat folder scope hints reach AchillesCLI without creating a KU by themselves.

## Decisions & Questions
### Question #1: Where is the AKU data model defined?

Response: The AKU data model is defined by AchillesAgentLib DS008 and implemented in `AgenticKnowledgeUnits/internal/schemas.mjs`, with search/index projections in `AgenticKnowledgeUnits/internal/indexing.mjs` and constants in `AgenticKnowledgeUnits/internal/constants.mjs`. AchillesCLI must treat those as the schema authority. This DS defines how AchillesCLI populates generic AKU fields such as `ku_name`, `ku_type`, `tags`, `keywords`, `summary`, `reusable_findings`, folder scopes, links, and results.

### Question #2: Why is Copilot behavior not specified in AKU DS008?

Response: AKU is a deterministic local library. Prompt interpretation, user-facing Copilot behavior, and semantic decisions about what to create or update belong to AchillesCLI. Ploinky WebChat remains generic transport and should not know about KUs. Keeping those responsibilities in this DS prevents the shared AKU library and transport layers from depending on one host surface.

### Question #3: How should AchillesCLI represent user-facing labels such as "experiment 1" before AKU has a first-class alias field?

Response: AchillesCLI should encode such labels through generic AKU metadata: `ku_name`, `keywords`, `tags`, summaries, result titles, and link summaries. If first-class `aliases` or `ordinal` fields become necessary, that change belongs first in AchillesAgentLib DS008 as a generic AKU data model refinement, then AchillesCLI can adopt it.

### Question #4: When may AchillesCLI create KUs automatically?

Response: Automatic creation is allowed only when the prompt clearly defines durable work units or durable outputs. Creating a folder and launching named experiments is sufficient. Merely opening Copilot in a folder, asking a question, or inspecting a file is not sufficient.

### Question #5: How should linked experiments enter context?

Response: The active KU inferred by AchillesCLI and any high-confidence natural-language matches should be included first. Link records may appear as lightweight hints. Linked target summaries should be opt-in or task-driven so sibling experiments do not swamp the current task context.

### Question #6: Are experiments a special implementation path?

Response: No. Experiments are one common KU type and the folder-plus-experiments prompt is a useful regression example because it exercises multi-KU creation, scope registration, linking, result retrieval, and natural-language labels. The implementation must generalize the same lifecycle to every `ku_type`. AchillesCLI may maintain a type policy table for defaults and preferred AKU APIs, but the table must treat unknown/custom type strings with a generic fallback and must not become Copilot-specific schema.

### Question #7: Is `ku_type` a closed enum?

Response: No. DS008 defines `ku_type` as an open caller-defined string. The recommended catalog exists for interoperability and default policies, not validation. AchillesCLI must not reject or remap a clear custom type solely because it is absent from the recommended catalog.

## Conclusion
AchillesCLI should make AKU memory feel automatic to the user while preserving a strict boundary: Copilot interprets prompts and chooses memory actions; AKU stores, indexes, searches, links, repairs, and packs local Knowledge Units deterministically.
