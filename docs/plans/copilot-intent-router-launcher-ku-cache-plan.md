# Copilot Intent Router With Agent Launcher Skills And KU Cache

Status: proposed

## Purpose

This plan replaces user-visible `@agent` dispatch with semantic Copilot routing.
Ploinky WebChat remains a generic transport. AchillesCLI Copilot decides, from
the prompt and local context, whether to answer normally or invoke an external
provider agent such as Open Interpreter. Provider results that are pure
information may be stored in Agentic Knowledge Units and reused later.

The plan covers the affected boundaries in:

- `ploinky`
- `ploinky/node_modules/achillesAgentLib`
- `AssistOSExplorer`
- `AssistOSExplorer/AchillesCLI`
- `AssistOSExplorer/webmeetAgent`
- `copilot-agents`
- `skill-manager-cli`

## Target Invariants

1. Ploinky WebChat is transport-only. It must not know `openInterpreterAgent`,
   search providers, `researchRelay`, backend tags, or provider MCP tool names.
2. Users do not invoke agents with `@agent` tokens. Natural language and context
   drive routing.
3. AchillesCLI Copilot owns routing and memory policy.
4. Each external provider has a deterministic launcher cskill. The launcher
   validates deployment, materializes safe context, and dispatches through
   `researchRelay.research_task_submit`.
5. `researchRelay` remains the secure provider dispatcher. Provider agents own
   backend runtime setup and sandbox execution.
6. Request-time LLM inference goes through `achillesAgentLib` only.
7. AKU remains deterministic local storage. AchillesCLI may add policy around
   cached provider results, but must not change AKU schema or read `.aku`
   internals directly.
8. Open Interpreter execution is not served from cache. It can create useful
   memory records, but repeated execution prompts should execute again.
9. Pure-information backends, such as a future web-search provider, may cache
   results when the launcher declares them cacheable.
10. `@file:` and workspace-path references may remain as generic file-reference
    syntax. They are not agent invocation.

## Current Evidence To Preserve

- WebChat selects the active chat agent through `?agent=<name>` and Ploinky
  routing. This is generic and should remain unchanged.
- AchillesCLI currently parses tag relay mentions in
  `achilles-cli/src/lib/webchatTagRelay.mjs`. That file also owns generic
  WebChat envelope parsing and safe resource materialization, so it must not be
  deleted before those helpers are extracted.
- `researchRelay.research_task_submit` already forwards provider-backed tasks
  through secure-wire MCP with the router invocation token.
- `AkuMemoryAdapter` already exists in AchillesCLI and is the only component
  that should orchestrate AKU prompt preflight and postflight mutations.
- `copilot-agents` specs and WebMeet specs currently describe tagged research
  chat. They must be updated with the same behavioral change as the code.

## Architecture

```text
user prompt / WebChat envelope
    |
    v
AchillesCLI non-slash turn handler
    |
    |-- normalize WebChat envelope
    |-- preserve invocation token in context
    |-- materialize safe attachments / workspace references
    v
AkuMemoryAdapter preflight
    |
    |-- ordinary ContextPack retrieval
    |-- cache lookup only for cacheable backend shapes
    |
    |-- cache hit -> render cached result with local-memory provenance
    |
    v
copilot-router oskill
    |
    |-- no provider needed -> normal Copilot answer / existing skills
    |-- Open Interpreter needed -> launch-open-interpreter cskill
    |-- search needed and provider deployed -> launch-web-search cskill
    |-- search needed and provider absent -> explicit unavailable message
    v
launcher cskill
    |
    |-- validate deployment / provider catalog
    |-- call researchRelay.research_task_submit through router MCP
    |-- return result_text plus persistence hints
    v
AkuMemoryAdapter postflight
    |
    |-- cache only if launcher.cacheable is true
    |-- persist durable work records when task/result warrants it
    v
chat output
```

## Skill Choice

Use an oskill for the semantic router because the routing decision needs LLM
judgment over prompt, AKU context, attachments, and available provider
capabilities.

Use cskills for provider launchers because dispatch is deterministic once the
router selects a backend. A launcher should parse input, validate deployment,
build the `research_task_submit` payload, call MCP, normalize output, and return
structured metadata.

Use `## Session Type: loop` for the router descriptor. The current
OrchestratorSkillsSubsystem treats only `loop` as a special session type; other
values fall back to SOP execution.

## Launcher Contract

Each launcher cskill descriptor must declare:

- `backend`: relay backend id, for example `open-interpreter`
- `cacheable`: boolean, default `false`
- `ttl_hint_seconds`: optional, used only when `cacheable` is true
- `requiresInvocationToken`: true for delegated MCP calls
- `providerAvailability`: `active`, `disabled`, or `not_deployed`

Input:

```json
{
  "prompt": "natural language provider task",
  "workingDir": "/workspace/current",
  "attachments": [],
  "references": [],
  "resources": [],
  "paths": [],
  "origin": {}
}
```

Output:

```json
{
  "ok": true,
  "backend": "open-interpreter",
  "cacheable": false,
  "result_text": "natural-language answer",
  "persistence_hint": {
    "ku_type": "code_work",
    "record_result": true,
    "ttl_hint_seconds": null
  },
  "diagnostics": {}
}
```

If a user asks for a backend whose provider is not deployed, the launcher/router
must return a clear user-facing unavailable message. It must not silently fall
through to ordinary chat and risk fabricating current information.

## KU Result Cache Policy

Cache only pure-information provider results.

Recommended KU type:

```text
agent.result.<backend>
```

Examples:

- `agent.result.web-search`
- `agent.result.open-interpreter` is allowed as a record type if explicitly
  useful, but Open Interpreter launchers must set `cacheable: false`, so it is
  not used for automatic cache hits.

Metadata and search terms must fit existing AKU public fields:

- Put cache keys in manifest or result `keywords` and `tags`.
- Put non-sensitive structured details in result `metadata`.
- Use `recordResult`, `initKU`, `search`, `loadKU`, `listResults`,
  `buildContextPack`, and `buildScopedContextPack` only through
  `AkuMemoryAdapter`.

Suggested cache fields:

```json
{
  "prompt_hash": "sha256-of-normalized-prompt",
  "prompt_text": "original prompt",
  "backend": "web-search",
  "generated_at_iso": "2026-05-20T00:00:00.000Z",
  "working_dir": "/workspace/current",
  "ttl_hint_seconds": 86400,
  "origin_paths": []
}
```

Cache hit policy:

1. Derive a backend shape before invoking a launcher. Only shapes whose launcher
   is cacheable are eligible.
2. Exact normalized `prompt_hash` plus same working directory plus unexpired TTL
   is a cache hit.
3. Otherwise run AKU `search()` with filters for the cacheable `ku_type`, prompt
   terms, backend tags, and a conservative limit.
4. Treat lexical AKU scores as AKU-local ranking, not vector similarity. Exact
   hits require backend, working directory, prompt hash, and TTL. Similar-prompt
   hits may omit prompt-hash equality only after an AKU `search()` fallback finds
   an agent-result cache record with the same backend, same working directory,
   unexpired TTL, and conservative prompt-term overlap.
5. If no confident hit exists, run the launcher.
6. Never cache secrets, hidden reasoning, invocation tokens, raw private prompts,
   or sensitive file content.

## Implementation Phases

### Phase 0 - Spec Authority And Scope Lock

1. Confirm whether WebMeet is in scope for the same change. This plan assumes it
   is, because the new invariant says agents are not referenced with `@`.
2. Create a new DS in `copilot-agents/docs/specs/` for semantic Copilot routing
   and launcher contracts. Use the next contiguous DS number after checking the
   current matrix.
3. Update or supersede tag-based specs in `copilot-agents`:
   - `DS000-vision.md`
   - `DS002-ploinky-runtime-invariants.md`
   - `DS003-agent-inventory.md`
   - `DS005-research-relay-agent.md`
   - `DS006-open-interpreter-agent.md`
   - `DS010-achilles-cli-launch-integration.md`
   - `DS012-tagged-research-chat-relay.md`
4. Update AchillesCLI specs:
   - `DS010-ecosystem-integration.md`
   - `DS011-aku-aware-copilot-memory.md`
   - `docs/specs/matrix.md`
5. Update WebMeet specs if WebMeet is included:
   - `webmeetAgent/docs/specs/DS11-tagged-research-chat.md`
   - `webmeetAgent/docs/index.html`
6. Update Ploinky WebChat docs/tests only where they mention agent tag
   suggestions or visual `@agent` affordances.

### Phase A - Extract Generic WebChat Context Helpers

1. Split `achilles-cli/src/lib/webchatTagRelay.mjs` into:
   - `webchatEnvelope.mjs`: `normalizeWebchatMessage`,
     `normalizeWebchatReferences`
   - `webchatResources.mjs`: attachment/reference materialization and
     workspace confinement helpers
   - `agentMcpClient.mjs`: generic router-mediated MCP client helpers,
     if still needed in AchillesCLI launcher code
2. Preserve byte caps, symlink checks, `.secrets` rejection, upload-path
   confinement, and invocation-token parsing.
3. Update existing tests to target the new helper modules.
4. Do not remove tag relay behavior until the new router path is ready.

### Phase B - Invocation Token And Context Plumbing

1. In AchillesCLI WebChat mode, after `normalizeWebchatMessage`, put
   `normalizedMessage.invocationToken` into `context.invocationToken`.
2. Put normalized attachments and references into context in a generic shape:
   - `context.webchatAttachments`
   - `context.webchatReferences`
   - `context.webchatResources`
   - `context.webchatPaths`
3. Ensure single-shot mode can also pass an invocation token only when supplied
   by a routed runtime context. Do not invent tokens locally.
4. Add tests proving a cskill can read the token from action args/context.

### Phase C - Make Launcher Skills Discoverable

1. Decide the durable skill root for provider launchers. Acceptable options:
   - built-in AchillesCLI skills
   - packaged dependency exposing `skills/`
   - explicit `--skill-root` supplied by a safe launch-extension contract
2. Do not rely on `copilot-agents/achilles-skills` unless AchillesCLI is
   explicitly configured to discover that directory.
3. Document the chosen discovery path in AchillesCLI DS010 and copilot-agents
   specs.

### Phase D - Implement Launch Open Interpreter

1. Reshape `launch-open-interpreter` from URL handoff to transparent MCP
   dispatch.
2. Input should include prompt, working directory, attachments, references,
   resources, paths, and origin.
3. Validate that `researchRelay` is routed and that the relay catalog has
   `open-interpreter`.
4. Call `researchRelay.research_task_submit` through the Ploinky router with the
   current invocation token.
5. Return natural-language `result_text`.
6. Set `cacheable: false`.
7. Persist only durable consequences when task/result warrants it, such as
   `experiment`, `code_work`, `validation`, or `failure_note` records.

### Phase E - Define Search Launcher Slot Without Fabricating Search

1. Add the `launch-web-search` contract only as disabled/dormant unless a real
   provider agent exists.
2. If the router sees a clear web-search request while the provider is absent,
   return an explicit unavailable message and do not write KU.
3. When the provider lands, activate the launcher with:
   - `backend: web-search`
   - `cacheable: true`
   - default `ttl_hint_seconds: 86400`
   - result KU type `agent.result.web-search`
4. The provider, not AchillesCLI or Ploinky, owns online search implementation,
   provider credentials, browsing rules, and result normalization.

### Phase F - Implement Copilot Router

1. Create `achilles-cli/src/skills/copilot-router/oskill.md`.
2. Include clear positive and negative routing examples:
   - Run/execute/test/debug/build script -> `launch-open-interpreter`
   - Search online/current/recent/find articles/look up -> search launcher only
     when provider is active
   - Explain how to run code -> normal chat, not Open Interpreter
   - Search memory / what did we discuss -> AKU retrieval, not web search
   - Ordinary coding, skill management, explanations -> existing Copilot path
3. Use `## Allowed-Skills` for launchers and existing orchestrators needed for
   normal AchillesCLI work.
4. Use `## Session Type: loop`.
5. Wire non-slash WebChat turns so the router is the direct decision path. Avoid
   a top-level LLM call that merely decides to call another LLM router.
6. Keep debug diagnostics behind `ACHILLES_DEBUG=true`.

### Phase G - AKU Adapter Extensions

Add methods to `AkuMemoryAdapter`:

- `lookupCachedAgentResult({ prompt, backend, workingDir, ttlHintSeconds })`
- `persistAgentResult({ prompt, backend, resultText, workingDir, cacheable, ttlHintSeconds, originPaths, metadata })`
- `recordAgentDurableOutcome({ backend, result, persistenceHint, context })`

Rules:

1. These methods use only public `AgenticKnowledgeUnits` APIs.
2. Missing `.aku` remains non-blocking.
3. No KU is created for an ordinary prompt unless the launcher result is
   cacheable or the task/result implies durable memory.
4. Cache lookup runs before launcher execution only for records that already
   came from a cacheable launcher. The WebChat cutover may perform one
   backend-agnostic AKU lookup before the router to avoid a second LLM routing
   pass; the adapter must still require an `agent-result-cache` record, same
   working directory, unexpired TTL, and exact or conservative similar-prompt
   matching.
5. Postflight cache writes run only when `cacheable === true`.

### Phase H - Cutover From Tag Relay

1. Remove tag-relay CLI flags from AchillesCLI:
   - `--research-tags`
   - `--tag-relay`
   - `--tag-relay-agent`
   - `--tag-relay-submit-tool`
   - `--tag-relay-list-tool`
   - `--tag-relay-tags`
   - `--tag-relay-timeout-ms`
   - compatibility aliases for research relay flags
2. Remove `tagRelay.handle()` from WebChat non-slash processing.
3. Keep `forward-envelope` support.
4. Delete the remaining tag-only relay module after generic helpers are moved.
5. Update `researchRelay/IDE-plugins/research-relay/config.json` so it no longer
   contributes tag-relay query parameters. It may contribute only generic
   metadata needed for skill discovery or provider availability, if a DS approves
   that contract.
6. Update smoke docs and tests that currently send `@open-interpreter`.

### Phase I - Ploinky WebChat UI Cleanup

1. Remove the tag catalog provider from WebChat if it exists only for agent
   tags.
2. Preserve generic workspace path autocomplete and slash command autocomplete.
3. Preserve `@file:` highlighting only if it remains the chosen file-reference
   syntax.
4. Stop rendering arbitrary `@word` as an agent mention in composer and message
   bubbles.
5. Add tests proving `@open-interpreter` is plain text and no autocomplete
   "Agents" group appears.

### Phase J - WebMeet Alignment

If WebMeet is included in this change:

1. Remove WebMeet configured research tag dispatch.
2. Remove `@open-interpreter` from WebMeet autocomplete catalogs and mention
   highlighting.
3. Keep normal meeting chat persistence.
4. Preserve file/user mention behavior only if it is generic and not agent
   dispatch.
5. Update `webmeetAgent` DS11 from tagged research chat to no-agent-tag chat, or
   supersede it with a new DS.
6. Leave future meeting-to-agent behavior as a separate explicit Copilot bridge,
   not `@agent` parsing inside WebMeet.

### Phase K - Standalone CLI Alignment

Mirror the final AchillesCLI changes into `skill-manager-cli` according to the
AchillesCLI divergence rule:

- router skill descriptor
- AKU adapter extensions
- WebChat envelope helper changes, if applicable
- tests adjusted for standalone paths/imports

Do this after the canonical AchillesCLI version stabilizes.

## Tests

### AchillesCLI

Add or update:

- `copilotRouter.test.mjs`: routing goldens and false positives
- `launcherOpenInterpreter.test.mjs`: payload shape and invocation-token use
- `akuAgentResultCache.test.mjs`: cache hit/miss, TTL, no writes for
  `cacheable:false`
- `atMentionPlainText.test.mjs`: `@open-interpreter list primes` is plain text
  and does not call `research_task_submit`
- migrated WebChat envelope/resource tests after helper extraction

Run:

```sh
cd AssistOSExplorer/AchillesCLI
node tests/run-all.mjs
```

### copilot-agents

Update:

- relay tests for `research_task_submit` as the canonical dispatcher
- plugin tests after tag-relay launch metadata removal
- manifest validation
- docs/spec matrix tests if present

Run:

```sh
cd copilot-agents
node --test tests/unit/*.test.mjs
node scripts/validate-manifests.mjs
```

### Ploinky

Update WebChat tests for:

- no agent tag autocomplete
- no arbitrary `@word` agent highlighting
- `@file:` or workspace references still work if retained
- `forward-envelope` still carries attachments, references, and invocation token

Run relevant suites:

```sh
cd ploinky
npm test
```

For router/startup-sensitive edits also run:

```sh
cd ploinky
tests/smoke/test_all.sh
tests/fast/test_all.sh
```

### WebMeet

If included:

- update tagged-research tests into plain-chat tests
- prove `@open-interpreter` persists as ordinary chat text
- prove no relay call happens
- preserve file/user mention regressions as appropriate

Run:

```sh
cd AssistOSExplorer
node --test webmeetAgent/tests/unit/*.test.mjs
```

### Integration Smoke

1. Open Copilot normally with `forward-envelope=1`.
2. Prompt: "write a Python script that lists primes up to 100 and run it".
   Expect router selects Open Interpreter launcher, dispatch goes through
   `research_task_submit`, and no cache hit is used.
3. Repeat the same prompt. Expect a fresh Open Interpreter run.
4. Prompt: "@open-interpreter list primes". Expect ordinary Copilot text, no
   backend invocation.
5. Prompt: "search online for articles comparing local LLMs to cloud hosted
   ones" before a search provider exists. Expect a clear unavailable message,
   no KU write.
6. After a real search provider exists, repeat a search prompt. Expect first
   call to provider and second call served from AKU if TTL and confidence allow.
7. Confirm `ACHILLES_DEBUG=true` prints router diagnostics only in debug output,
   not in user-facing chat.

## Risks And Mitigations

- Nested LLM latency: direct-call the router skill for non-slash Copilot turns or
  integrate routing into the top-level prompt path.
- False-positive routing: include negative examples and strict tests for
  explanation, memory search, and ordinary coding prompts.
- Stale web answers: do not silently fall through to normal chat when a web
  provider is requested but absent.
- Unsafe resource forwarding: preserve the existing helper checks exactly during
  extraction.
- Cache poisoning or sensitive memory: keep cache writes launcher-declared,
  adapter-mediated, and sanitized.
- Spec drift: update DS files and matrices in the same change as behavior.

## Open Decisions

1. Where should provider launcher skills live so AchillesCLI discovers them
   without hardcoding a host-specific path?
2. Should WebMeet removal land in the same PR as Copilot routing, or in a
   immediately following PR? The invariant says same behavior, but the blast
   radius is larger.
3. Should `researchRelay` keep a disabled provider catalog entry for planned
   search, or should search be absent until a real provider agent exists?
4. What exact user-facing wording should appear when a requested provider is not
   deployed?
5. Should cached provider results mention "served from local memory" every time,
   or only when debug/provenance output is requested?

## Recommended Commit Slices

1. Specs first: define the semantic routing contract and supersede tag-based
   contracts.
2. Extract WebChat envelope/resource helpers with tests and no behavior change.
3. Add invocation-token context plumbing and launcher discovery.
4. Implement Open Interpreter launcher dispatch through `researchRelay`.
5. Add router oskill and route non-slash Copilot turns through it.
6. Add AKU cache extensions for cacheable provider results.
7. Remove tag relay flags and WebChat `@agent` UI affordances.
8. Align WebMeet if in scope.
9. Mirror standalone CLI changes.
10. Run integration smoke and update docs/index pages.
