# Prompt For New Codex Session

You are working in `/Users/danielsava/work/file-parser`. Implement the plan in:

`/Users/danielsava/work/file-parser/AssistOSExplorer/AchillesCLI/docs/plans/copilot-intent-router-launcher-ku-cache-plan.md`

Goal: replace user-visible `@agent` dispatch with semantic AchillesCLI Copilot routing while keeping Ploinky WebChat agent-agnostic. Copilot should decide from prompt plus context whether to answer normally or invoke an external provider agent such as Open Interpreter. Pure-information provider results may be cached in AKU. Open Interpreter execution must not be served from cache.

Before editing, read these canonical instructions and invariants:

1. `/Users/danielsava/work/file-parser/CLAUDE.md`
2. `/Users/danielsava/work/file-parser/ploinky/CLAUDE.md`
3. `/Users/danielsava/work/file-parser/AssistOSExplorer/CLAUDE.md`
4. `/Users/danielsava/work/file-parser/AssistOSExplorer/AchillesCLI/CLAUDE.md`
5. `/Users/danielsava/work/file-parser/copilot-agents/CLAUDE.md`
6. `/Users/danielsava/work/file-parser/ploinky/node_modules/achillesAgentLib/CLAUDE.md`
7. The runtime invariants skill, especially the rules that Ploinky framework code must remain agent-agnostic and all request-time LLM inference goes through `achillesAgentLib`.

Treat the plan file as the implementation source of truth for this task. If you discover code/spec facts that conflict with it, update the plan or specs first with a clear decision entry before implementing the conflicting behavior.

Core invariants to preserve:

- Ploinky WebChat remains transport-only. Do not add Open Interpreter, web search, `researchRelay`, backend tags, or provider MCP tool names to Ploinky framework code.
- Users do not route agents with `@agent` syntax. `@open-interpreter` must become ordinary chat text and must not trigger provider dispatch.
- `@file:` and workspace-path references may remain as generic file-reference syntax if current code relies on them.
- AchillesCLI Copilot owns semantic routing and AKU policy.
- Each provider launcher is a deterministic cskill. Use an oskill for the semantic router.
- Provider launchers call `researchRelay.research_task_submit` through router-mediated MCP with the current invocation token.
- `researchRelay` remains the secure dispatcher to provider agents. Do not bypass it by directly calling `openInterpreterAgent` from Copilot launchers unless specs are deliberately changed first.
- Open Interpreter launcher sets `cacheable: false`; repeated execution prompts should execute again.
- Cache only pure-information provider results from launchers that declare `cacheable: true`.
- AKU access goes only through `AkuMemoryAdapter` and public `AgenticKnowledgeUnits` APIs. Do not read or write `.aku` internals directly.
- Do not store secrets, invocation tokens, hidden reasoning, raw private prompts, or sensitive file content in AKU or logs.

Suggested implementation order:

1. Read the plan file fully and inspect the current implementation paths it names.
2. Update specs first enough to authorize the new semantic-routing contract:
   - `copilot-agents/docs/specs/*` tag-based specs and matrix
   - `AssistOSExplorer/AchillesCLI/docs/specs/DS010-ecosystem-integration.md`
   - `AssistOSExplorer/AchillesCLI/docs/specs/DS011-aku-aware-copilot-memory.md`
   - WebMeet specs if WebMeet is kept in scope
3. Extract generic WebChat helpers from `achilles-cli/src/lib/webchatTagRelay.mjs` before removing tag dispatch:
   - envelope normalization
   - invocation-token extraction
   - attachment/reference resource materialization
   - workspace confinement, symlink checks, byte caps, `.secrets` rejection
4. Propagate `normalizedMessage.invocationToken` into AchillesCLI skill execution context so launcher cskills can call router MCP.
5. Decide and implement launcher skill discovery. Do not assume `copilot-agents/achilles-skills` is loaded unless AchillesCLI is explicitly configured to discover it.
6. Reshape `launch-open-interpreter` from URL handoff to transparent `researchRelay.research_task_submit` dispatch. It must return natural-language result text and `cacheable: false`.
7. Add the `copilot-router` oskill with `## Session Type: loop`, strict routing instructions, and false-positive examples.
8. Wire non-slash AchillesCLI WebChat turns through the router without introducing an avoidable double-router LLM call.
9. Extend `AkuMemoryAdapter` with cache lookup/persist helpers for cacheable provider results only.
10. Remove tag-relay flags and tag parsing/dispatch after the router path is working.
11. Clean up Ploinky WebChat tag autocomplete/highlighting for agent tokens while preserving generic file/workspace features.
12. Align WebMeet if the chosen scope includes it: remove `@open-interpreter` dispatch/autocomplete and make it ordinary chat text.
13. Mirror required AchillesCLI changes into `skill-manager-cli` per divergence rules.
14. Update docs/index pages, smoke docs, and test expectations that still describe `@open-interpreter`.

Tests and validation to add/update:

- AchillesCLI:
  - router golden prompts and false positives
  - launcher payload shape and invocation-token use
  - AKU cache hit/miss, TTL, and no write for `cacheable:false`
  - `@open-interpreter list primes` is plain text and does not call `research_task_submit`
  - migrated WebChat envelope/resource helper tests
- copilot-agents:
  - `research_task_submit` remains canonical dispatcher
  - plugin tests after removing tag-relay launch metadata
  - manifest validation
- Ploinky:
  - no agent tag autocomplete
  - no arbitrary `@word` agent highlighting
  - forward-envelope still carries attachments, references, and invocation token
- WebMeet if in scope:
  - `@open-interpreter` persists as ordinary chat
  - no relay call happens
  - generic file/user mention behavior remains intact where applicable

Run the narrowest meaningful tests first, then broaden. Expected commands from the plan:

```sh
cd /Users/danielsava/work/file-parser/AssistOSExplorer/AchillesCLI
node tests/run-all.mjs

cd /Users/danielsava/work/file-parser/copilot-agents
node --test tests/unit/*.test.mjs
node scripts/validate-manifests.mjs

cd /Users/danielsava/work/file-parser/ploinky
npm test
```

For Ploinky router/startup-sensitive changes also run:

```sh
cd /Users/danielsava/work/file-parser/ploinky
tests/smoke/test_all.sh
tests/fast/test_all.sh
```

If WebMeet changes are included:

```sh
cd /Users/danielsava/work/file-parser/AssistOSExplorer
node --test webmeetAgent/tests/unit/*.test.mjs
```

Be careful with dirty worktrees. Do not revert unrelated user changes. Keep edits scoped, update specs with behavior, and report any tests that cannot be run.
