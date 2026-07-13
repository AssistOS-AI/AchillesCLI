---
id: DS010
title: Ecosystem Integration (Ploinky, AchillesAgentLib, AchillesIDE)
status: active
owner: AchillesCLI Maintainers
summary: Defines integration boundaries and contracts between AchillesCLI and the surrounding ecosystem repositories.
---

# DS010-ecosystem-integration

## Introduction
This DS defines the required integration boundaries for AchillesCLI across the local ecosystem repositories used in development and runtime workflows.

## Core Content
Integration scope:
1. AchillesCLI is a runnable CLI/runtime repository.
2. AchillesAgentLib provides the core agent runtime primitives consumed by AchillesCLI.
3. Ploinky provides workspace/runtime orchestration where AchillesCLI can be enabled and executed.
4. AchillesIDE provides a related multi-agent workspace/IDE surface whose contracts shape interoperability expectations.

Portable integration references (any environment):
1. Ploinky repository: `<workspace-root>/ploinky`
2. AchillesAgentLib installation path: `<ploinky-root>/node_modules/achillesAgentLib` (or equivalent dependency root resolved by runtime config)
3. AchillesIDE repository: `<workspace-root>/.ploinky/repos/AchillesIDE`

AchillesAgentLib contract:
1. AchillesCLI imports and uses `MainAgent`, `LLMAgent`, and related runtime helpers.
2. AchillesCLI delegates skill discovery/orchestration semantics to AchillesAgentLib.
3. AchillesCLI must preserve compatibility with AchillesAgentLib skill subsystem expectations.
4. When AchillesCLI uses Agentic Knowledge Units, AchillesAgentLib DS008 remains the AKU library authority. AchillesCLI-specific Copilot memory behavior is governed by DS011 and must not be pushed into the AKU library contract.

Ploinky integration boundary:
1. AchillesCLI should remain compatible with workspace-managed runtime contexts.
2. Startup assumptions must avoid hardcoded machine-specific paths in core runtime logic.
3. Session/webchat runtime paths should keep durable-state assumptions aligned with orchestrated process lifecycles.
4. The Ploinky agent manifest should use the shared `docker.io/assistos/ploinky-node:24-bookworm-tools` image so Explorer cold starts reuse the same Node 24 glibc runtime and preinstalled dependency-cache tools as the rest of the default agent graph.
5. The Ploinky agent manifest temporarily declares `SOUL_GATEWAY_API_KEY` as a `sharedGeneratedSecret` with `explicitOverride: true` so Explorer-launched AchillesCLI can honor a hosted Soul Gateway key from parent `.env` files. This is not canonical AchillesCLI integration behavior and must be removed when the local deployed Soul Gateway is the only supported provider path.
6. AchillesCLI exposes its skill catalog as MCP tools via the AgentServer mechanism. Each user skill is exposed as `execute_<sanitised_skill_name>` with an input schema derived from the skill's argument expectations. WebChat clients query this catalog at session start to populate slash-command autocomplete menus. AchillesCLI slash commands are provided through a dedicated MCP catalog tool that returns a structured command/sub-command payload and does not execute chat prompts. That catalog tool accepts an optional `dir` argument and uses `achillesAgentLib` skill discovery from that directory to publish argument completions for slash commands that operate on skills. When a discovered skill descriptor contains `## Help`, the catalog publishes that text as the argument completion description for the skill.
7. The webchat interactive mode (`runWebchatInteractive`) accepts ESC (`\x1b`) as a standalone input line to cancel the current prompt execution. This enables remote cancel from browser-based WebChat sessions.
8. The webchat interactive mode must treat `@open-interpreter` and other
   `@agent`-shaped tokens as ordinary chat text. Provider dispatch is semantic
   and launcher-driven; Ploinky WebChat remains only the envelope and
   invocation-token transport.
9. Generic WebChat envelope and resource helpers live in AchillesCLI. These
   helpers normalize envelope text, extract the
   invocation token, and materialize browser attachments or workspace
   references only from supported WebChat storage: legacy shared blob ids under
   the configured shared root and Ploinky session-upload paths under the active
   WebChat working directory (`uploads/<sessionId>/...`). Cwd-relative session
   upload paths must stay inside the working directory after realpath
   resolution, reject traversal, `.secrets`/`*.secrets`, and upload metadata
   internals, and preserve the same byte caps as other forwarded resources.
10. Non-slash WebChat turns are routed through the built-in `copilot-router`
   oskill. The router may call deterministic launcher cskills such as
   `launch-open-interpreter`, `launch-web-search`, or `launch-opencode`.
   When the user explicitly names `opencode` or `opencodeAgent`, the router
   must select `launch-opencode` before generic execution launchers so the
   named provider intent is preserved. Launchers receive the
   normalized prompt, safe WebChat context, and current invocation token through
   the AchillesCLI skill execution context. Launchers must call external
   provider execution only through
   `copilotProviderRelay.copilot_provider_task_submit` via router-mediated MCP.
   Provider-specific launchers may perform a bounded
   provider-owned status probe through router-mediated MCP before submitting the
   task so unavailable provider routes fail with an explicit user-facing
   message instead of a later relay submission error. Directory and other
   non-file workspace references may be represented in Copilot prompt context,
   but launchers must forward only file path strings in relay `paths` payloads.
11. The Explorer Copilot launcher may consume runtime plugin metadata from
   `file-exp:copilot-launch-extension` to add generic WebChat launch query
   parameters such as `forward-envelope=1` and `workspace-dir`. It must not add
   provider backend ids, provider agent ids, or provider MCP tool names to the
   WebChat URL; the visible Explorer action remains the
   normal `Open Copilot here` action.
12. Repository maintenance through `/update repos` runs inside the active AchillesCLI runtime context and updates repositories already cloned under `.achilles-cli/repos/`; hosts must surface aggregated per-repository git pull failures unchanged.
13. In webchat runtime mode, AchillesCLI installs a supervisor that auto-approves loop-session tool calls and emits structured progress lines on stdout. Progress lines use `{"__webchatProgress":1,"type":"tool_reason","tool":"...","reason":"..."}` and must be treated as UI progress metadata, not as assistant answer text.
14. In webchat runtime mode, AchillesCLI preserves the sanitized
    `origin.publicBaseUrl` field from forwarded WebChat envelopes in launcher
    context. Launcher skills may use this same-origin router base for
    user-facing browser links, while ignoring malformed or non-HTTP origin
    hints.
15. Ploinky marks an existing WebChat conversation with
    `PLOINKY_WEBCHAT_HAS_HISTORY=1`. AchillesCLI must use that flag by itself to
    suppress the new-conversation intro. Folder session identity and persisted
    history remain host-owned; AchillesCLI does not require a session-id
    environment variable because Ploinky restores prior turns through the next
    normal prompt.

AchillesIDE interoperability boundary:
1. AchillesIDE documents a broader agent ecosystem with MCP and workspace routing expectations.
2. AchillesCLI documentation must remain explicit about what is native to CLI vs what belongs to IDE/router hosts.
3. Shared conventions (safe user output, debug gating, deterministic command behavior) must remain compatible across ecosystem tools.
4. AchillesCLI may ship IDE menu plugins through `achilles-cli/IDE-plugins/` for workspace skill-management affordances. The `edit-skills-manifest` plugin contributes only to Explorer folder context menus, uses Explorer's existing file read/write tools, and persists `ploinky-skills-manifest.json` as a JSON array of skill repository URLs in the selected folder. It must not add new router routes, MCP tools, or privileged policy surfaces.

Cross-repository invariants:
1. No repository should assume hidden runtime side effects from another without documented contracts.
2. Integration docs must describe boundaries and responsibilities, not duplicate entire external specs.
3. When AchillesAgentLib or host-runtime integration points change, AchillesCLI DS files must be updated in the same change set.

Provider launcher discovery:
1. Built-in provider launcher skills under `achilles-cli/src/skills/` may
   provide fallback behavior, but they do not define provider availability.
2. In Ploinky workspaces, AchillesCLI discovers provider launcher skills
   generically from workspace-managed repository clones under
   `.ploinky/repos/<repo>/achilles-skills`. Discovery must not hardcode
   `copilot-agents`, backend names, provider agent ids, or provider MCP tool
   names.
3. A deployed repo launcher with the same normalized skill name may replace a
   built-in fallback during startup registration. This makes the invariant
   explicit: an external provider becomes selectable by exposing a launcher
   skill, not by a Ploinky enable-research command or WebChat tag toggle.
4. A launcher that requires delegated MCP must declare that requirement in its
   descriptor and return a clear user-facing unavailable message when the
   invocation token or relay route is absent.
5. Provider availability for Copilot routing is determined by discovered
   launcher skills, not by a Ploinky research enable command, bundle command, or
   WebChat toggle. A launcher may report that its relay backend or provider
   route is unavailable, but it must not tell the user to run an enable-research
   command to make the provider selectable.
6. `launch-opencode` is the bounded exception for direct named-agent
   delegation. It calls the allowlisted `opencodeAgent.execute-task` MCP tool
   through the router, uses the hardcoded model
   `xai/grok-4.20-0309-non-reasoning`, returns plain text, and must not accept
   arbitrary target agent names or bypass Ploinky MCP authorization.
7. The AchillesCLI Ploinky manifest must enable
   `copilot-agents/opencodeAgent global` so OpenCode runs in the same workspace
   context as Copilot.
8. The AchillesCLI Ploinky manifest must keep `copilot-agents/GPTResearcher`
   as a `no-wait` dependency so GPTResearcher runtime setup failures do not
   block Explorer startup while the Python package installation path remains a
   temporary integration.

## Decisions & Questions

### Question #1: Why does the manifest temporarily opt `SOUL_GATEWAY_API_KEY` into explicit override?

Response:
Explorer launches AchillesCLI from selected workspace folders, and current workspaces may carry a hosted Soul Gateway key in a parent `.env`. The manifest opt-in lets Ploinky expose that explicit hosted key to AchillesAgentLib during startup while preserving generated Ploinky agent credentials for the canonical local route. This is a temporary compatibility bridge, not the long-term ecosystem contract.

Temporary implementation offset:

```text
achilles-cli/manifest.json:L6-L10
```

### Question #2: Why is the skills manifest editor shipped by AchillesCLI instead of Explorer?

Response:
The editor changes AchillesCLI-owned skill-management workflow configuration while using Explorer only as the host surface for folder context menus and file persistence. Keeping the plugin under `achilles-cli/IDE-plugins/` lets AchillesCLI own the UX and manifest contract without adding Explorer-specific routes, tools, or policy behavior.

## Conclusion
AchillesCLI is a first-class runtime component inside a larger ecosystem; integration quality depends on explicit boundaries with Ploinky orchestration, AchillesAgentLib runtime semantics, and AchillesIDE interoperability expectations.
