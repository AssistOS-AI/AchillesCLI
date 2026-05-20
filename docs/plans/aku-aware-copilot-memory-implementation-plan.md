# AKU-Aware Copilot Memory Implementation Plan

Status: draft

Primary contracts:

- AchillesCLI DS011: `docs/specs/DS011-aku-aware-copilot-memory.md`
- AchillesAgentLib DS008: `ploinky/node_modules/achillesAgentLib/docs/specs/DS008-AgenticKnowledgeUnits.md`

## Purpose

Implement AKU-aware Copilot memory so users can work in natural language while AchillesCLI automatically detects which local Knowledge Units should be read, created, updated, linked, or used for retrieval.

AKU remains a local deterministic library. It does not know about Copilot, WebChat, Explorer, prompts, or semantic intent. AchillesCLI owns prompt-aware memory orchestration and calls public `AgenticKnowledgeUnits` APIs.

## Non-Negotiable Invariants

1. Ploinky WebChat and Explorer remain generic transport. They may pass prompt text, working directory, folder hints, attachments, and workspace-path references, but they must not know about KUs.
2. AchillesCLI must not read or write `.aku` files directly. All AKU access goes through `AgenticKnowledgeUnits`.
3. Users are not expected to reference KU ids. The user-facing contract is natural language.
4. `ku_type` is an open caller-defined string. Recommended types provide defaults and interoperability only; they are not a closed enum.
5. Unknown/custom `ku_type` strings must fall back to generic KU behavior.
6. Folder/workstream behavior is a scope role expressed through folder-scope records and KU links. It is not a required closed schema type.
7. Preflight is read-oriented. It may search and build ContextPacks, but it must not mutate memory from a folder hint alone.
8. Mutations require a concrete memory action inferred from the prompt or task result.
9. No hidden reasoning, private prompts, credentials, secrets, or sensitive file content may be persisted into AKU.

## Target Architecture

Add one AchillesCLI-owned memory adapter:

```txt
achilles-cli/src/lib/akuMemory/
  AkuMemoryAdapter.mjs
  akuPlanningPacket.mjs
  akuIntentAnalyzer.mjs
  akuTypePolicies.mjs
  akuContextFormatter.mjs
  akuSessionState.mjs
```

The adapter is the only AchillesCLI component that orchestrates AKU preflight, memory action planning, action execution, and postflight persistence.

Public flow:

```txt
Prompt/runtime input
-> AKU planning packet
-> read-only AKU preflight
-> compact ContextPack injection
-> main agent execution
-> explicit AKU memory actions
-> optional postflight persistence
```

## Phase 1: Confirm AKU Library Contract

1. Inspect `AgenticKnowledgeUnits/internal/schemas.mjs` and confirm `createManifest()` accepts arbitrary non-empty `ku_type` strings.
2. Add AchillesAgentLib tests for open-string `ku_type` behavior if coverage does not exist.
3. Ensure `ku_type` is normalized as metadata only:
   - trim surrounding whitespace
   - default empty values deterministically
   - bound unreasonable length if the library already has a helper for that
   - never use `ku_type` as a path, filename, code symbol, permission, or execution hint
4. Do not add closed enum validation for `ku_type`.
5. Do not add Copilot-specific fields to AKU.
6. Verify `search()` can filter and rank arbitrary `ku_type` values as plain metadata.

Expected files:

- `ploinky/node_modules/achillesAgentLib/AgenticKnowledgeUnits/internal/schemas.mjs`
- `ploinky/node_modules/achillesAgentLib/AgenticKnowledgeUnits/internal/ranking.mjs`
- existing or new AchillesAgentLib AKU tests

## Phase 2: Add AchillesCLI Planning Packet

1. Create `achilles-cli/src/lib/akuMemory/akuPlanningPacket.mjs`.
2. Implement `buildAKUPlanningPacket(input)` with these fields:
   - raw user text
   - normalized prompt text
   - working directory
   - workspace root when known
   - folder scope hint when present
   - workspace-path references
   - attachment metadata
   - session id when available
   - previous AchillesCLI AKU session state
3. Accept both plain CLI prompts and WebChat-origin envelopes through the same generic input shape.
4. Sanitize paths and ignore invalid path hints.
5. Keep the packet free of WebChat-specific KU semantics.

Tests:

- plain prompt packet
- prompt with folder hint
- prompt with path references
- prompt with attachment metadata
- invalid path hint is ignored

## Phase 3: Add Type Policy Layer

1. Create `achilles-cli/src/lib/akuMemory/akuTypePolicies.mjs`.
2. Define policies for recommended common types:
   - `experiment`
   - `specification`
   - `scientific_article`
   - `internal_document`
   - `architecture_decision`
   - `research_note`
   - `data_analysis`
   - `code_work`
   - `validation`
   - `meeting_outcome`
   - `business_analysis`
   - `grant_or_deliverable`
   - `reusable_pattern`
   - `failure_note`
3. Each policy may define:
   - cue terms
   - default tags and keywords
   - preferred child records
   - preferred AKU APIs
   - useful retrieval fields
4. Add a generic fallback policy for unknown/custom type strings.
5. The fallback policy must still support create, search, update, link, record event, record document, register file, record result, and build context operations.
6. Type policies must not add schema fields outside DS008.

Tests:

- known type gets policy defaults
- unknown custom type is accepted
- custom type is not remapped to a recommended type
- policy lookup is deterministic

## Phase 4: Add Natural-Language Memory Intent Analyzer

1. Create `achilles-cli/src/lib/akuMemory/akuIntentAnalyzer.mjs`.
2. Implement deterministic extraction helpers for:
   - durable-work cues
   - read/retrieve cues
   - update cues
   - preserve/record cues
   - discard/status cues
   - path and folder mentions
   - ordinal labels such as `experiment 1`, `decision 2`, or `article 3`
3. Return a structured intent plan:

```js
{
  shouldUseAKU: true,
  shouldInitializeAKU: false,
  readQueries: [],
  candidateActions: [],
  durableUnits: [
    {
      operation: 'create',
      label: 'folder1',
      kuType: 'workstream',
      confidence: 0.82,
      evidence: ['create folder folder1'],
      scopeRole: 'folder_scoped_parent'
    }
  ],
  ambiguity: null
}
```

4. Use open-string `kuType` values. Prefer the user's own domain term when it is clear.
5. Use recommended common types only when they are the clearest match or when the user uses equivalent language.
6. Do not call AKU from the analyzer. It only produces an intent plan.
7. Keep LLM-assisted semantic classification optional and outside AKU. If used, AchillesCLI still converts the result into deterministic AKU API calls.

Tests:

- one-off explanation does not trigger mutation
- request to preserve a finding triggers durable action
- custom domain unit produces a custom `kuType`
- folder plus multiple child units produces multiple durable units
- ambiguous update returns disambiguation requirement

## Phase 5: Implement Read-Only Preflight

1. Create `achilles-cli/src/lib/akuMemory/AkuMemoryAdapter.mjs`.
2. Implement `preparePromptMemory(packet, options)`.
3. Instantiate `AgenticKnowledgeUnits` with `rootDir` equal to the active working directory or selected workspace root.
4. If `.aku` is absent and no durable memory action is requested, return an empty memory context.
5. If `.aku` exists:
   - call `loadAKU()`
   - derive search queries from prompt text, type hints, folder scope, path references, and previous session state
   - call `search()`, `buildContextPack()`, or `buildScopedContextPack()`
6. Do not create or update KUs during preflight.
7. Include matched evidence and confidence in adapter output.

Adapter output:

```js
{
  enabled: true,
  initialized: false,
  contextPack: {},
  candidates: [],
  activeScope: {},
  intentPlan: {},
  diagnostics: []
}
```

Tests:

- no `.aku` and ordinary prompt returns empty context
- no `.aku` and durable prompt requests initialization later
- existing `.aku` calls public search/context APIs
- folder hint alone does not create a KU

## Phase 6: Format Context For Agent Execution

1. Create `achilles-cli/src/lib/akuMemory/akuContextFormatter.mjs`.
2. Convert ContextPack output into a compact agent-facing section.
3. Keep retrieved memory separate from user instructions.
4. Include:
   - selected KU titles and types
   - summaries
   - reusable findings
   - result/document/file summaries when present
   - `matched_on` or `why_included`
   - confidence and ambiguity notes
5. Never dump full KU history by default.
6. Respect a character budget.

Tests:

- empty pack formats to no-op
- retrieved memory is separated from user text
- budget is respected
- match explanations are preserved

## Phase 7: Integrate Preflight Into AchillesCLI Prompt Paths

1. Update `achilles-cli/src/index.mjs` single-shot prompt path before `agent.executePrompt()`.
2. Update the webchat-origin non-slash prompt path before `agent.executePrompt()`.
3. Pass generic prompt/runtime context into `buildAKUPlanningPacket()`.
4. Attach formatted AKU context to the execution context or system prompt using a clearly marked section.
5. Preserve existing behavior when AKU is absent or disabled.
6. Do not change Ploinky WebChat handlers for KU semantics.
7. Do not change Explorer to know about KUs.

Tests:

- single-shot prompt receives AKU context when `.aku` exists
- webchat-origin prompt receives AKU context through AchillesCLI only
- existing non-AKU prompt behavior remains unchanged

## Phase 8: Add AKU Memory Action Surface

1. Add deterministic AchillesCLI-side actions that wrap public AKU APIs.
2. Required actions:
   - initialize AKU when needed
   - create KU
   - resolve KU candidates
   - update KU state
   - set KU status
   - record event
   - record document
   - register file
   - record result
   - record run
   - record validation
   - register folder scope
   - link KU
   - build scoped context
3. Each action validates the intent plan and ambiguity state before mutating memory.
4. Each action must call `AgenticKnowledgeUnits` methods, not filesystem helpers.
5. Add safeguards for:
   - ambiguous high-impact updates
   - discarded/obsolete candidates
   - path traversal
   - sensitive content persistence
6. Return structured outcomes for the orchestrator.

Tests:

- create custom type KU
- create recommended type KU
- register folder scope on selected KU
- link parent and child KUs
- reject ambiguous update
- reject direct sensitive persistence payload

## Phase 9: Teach The Orchestrator How To Use Memory Actions

1. Update `achilles-cli/src/prompts/orchestrator-prompt.mjs`.
2. State that AKU memory may be present as retrieved context.
3. State that users do not need KU ids.
4. State that durable memory operations must use the AKU action surface.
5. State that unknown/custom `ku_type` strings are allowed.
6. State that experiments are examples, not a special path.
7. State that Ploinky/WebChat/Explorer are not memory authorities.
8. Keep prompt wording concise and operational.

Tests:

- prompt text includes AKU memory guidance
- prompt text does not say `ku_type` is closed
- prompt text does not instruct direct `.aku` file access

## Phase 10: Implement Generic Creation And Update Lifecycle

1. Convert intent plan durable units into AKU action requests.
2. For each durable unit:
   - resolve existing candidates
   - decide create, update, fork, discard, or ask
   - call the matching AKU API
   - update AchillesCLI session state with active inferred KUs
3. For parent/child prompt structures:
   - create or resolve parent KU
   - register folder scope only when explicitly implied by durable work
   - create or resolve child KUs
   - link parent and children with generic `linkKU()`
4. For arbitrary user-defined types:
   - preserve the custom `ku_type`
   - use generic metadata and generic record APIs
   - do not remap solely for policy convenience
5. For common types:
   - apply policy defaults
   - use preferred child records and APIs when useful

Representative fixtures:

- folder-scoped parent with three experiments
- custom `ku_type` such as `customer_interview`
- specification update
- architecture decision retrieval
- reusable pattern preservation
- failure note recording

## Phase 11: Implement Generic Retrieval Lifecycle

1. Resolve natural-language references from the active scoped parent first.
2. Use:
   - AchillesCLI session state
   - folder-scope records
   - KU links
   - KU names and types
   - tags and keywords
   - summaries
   - result/document/file titles
   - recency and status from AKU search results
3. Support ordinal labels as session/local-scope labels, not schema fields.
4. If confidence is high, retrieve relevant results/documents/state through AKU APIs.
5. If confidence is low, return candidate KUs and ask for disambiguation.
6. Never guess by recursively scanning the filesystem.

Tests:

- retrieve `experiment 1` result from active parent
- retrieve custom type record by natural-language label
- retrieve architecture decision from active scope
- ambiguous label asks for disambiguation
- global search fallback works when no active scope exists

## Phase 12: Add Postflight Persistence

1. After a memory-relevant turn, inspect structured action outcomes and user-visible results.
2. Persist only durable consequences:
   - events
   - documents
   - registered files
   - results
   - runs
   - validations
   - reusable findings
   - session summaries when allowed
3. Skip persistence for:
   - hidden reasoning
   - raw private prompts
   - secrets
   - credentials
   - sensitive file content
4. If a task fails usefully, record a `failure_note` KU or type-appropriate event/result.
5. If the user rejects a result, use status/discard APIs rather than physical deletion by default.

Tests:

- success result persists through `recordResult()`
- validation persists through `recordValidation()`
- useful failure persists safely
- sensitive fields are not persisted
- rejected output is discarded/tombstoned, not silently deleted

## Phase 13: Boundary And Regression Tests

Add a dedicated test file:

```txt
tests/akuMemoryAdapter.test.mjs
```

Required coverage:

1. Planning packet construction from CLI prompts.
2. Planning packet construction from generic WebChat-origin runtime context.
3. Folder hint alone does not create a KU.
4. Existing `.aku` preflight uses public AKU APIs.
5. AchillesCLI code outside `akuMemory/` does not read `.aku` paths directly.
6. Open-string `ku_type` is accepted and preserved.
7. Unknown/custom `ku_type` gets generic fallback behavior.
8. Common types get policy defaults.
9. Multi-KU creation works without hardcoding experiments.
10. Folder-plus-three-experiments fixture still passes as a representative regression case.
11. Scoped retrieval works for common and custom types.
12. Ambiguous high-impact mutation asks for disambiguation.
13. Ploinky WebChat and Explorer remain KU-unaware.

## Phase 14: Documentation Updates

1. Update DS011 if implementation reveals a contract mismatch.
2. Update DS008 only if the AKU public API, data model, indexing behavior, or reliability contract changes.
3. Add this plan to the AchillesCLI docs index.
4. Keep implementation notes out of Ploinky WebChat docs unless a generic transport behavior changes.

## Phase 15: Verification Commands

Run focused checks first:

```sh
node --test tests/akuMemoryAdapter.test.mjs
node --test tests/copilotLaunch.test.mjs
node --test tests/webchatReferences.test.mjs
node --test tests/realAgentIntegration.test.mjs
```

Run broader AchillesCLI tests after the focused suite passes:

```sh
node tests/run-all.mjs
```

Run AchillesAgentLib AKU tests for any library changes:

```sh
node --test <aku-test-file>
```

Always run documentation whitespace checks before finishing:

```sh
git -C AssistOSExplorer/AchillesCLI diff --check
git -C ploinky/node_modules/achillesAgentLib diff --check
```

## Acceptance Criteria

1. A user can ask naturally for prior work and AchillesCLI retrieves relevant AKU context without the user naming a KU id.
2. A user can ask for durable work in any clear domain type and AchillesCLI creates or updates KUs with open-string `ku_type` values.
3. Unknown/custom `ku_type` strings are preserved and searchable.
4. The common type policy table improves defaults but is not a validator.
5. Folder launch alone does not create memory.
6. Ploinky WebChat and Explorer remain generic transport.
7. AchillesCLI never reads or writes `.aku` internals directly.
8. Context injection is compact, explainable, and separated from user instructions.
9. Ambiguous mutations ask for disambiguation.
10. The implementation passes focused AKU memory tests and existing Copilot/WebChat regression tests.
