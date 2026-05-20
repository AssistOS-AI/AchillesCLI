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
4. AchillesCLI exposes its skill catalog as MCP tools via the AgentServer mechanism. Each user skill is exposed as `execute_<sanitised_skill_name>` with an input schema derived from the skill's argument expectations. WebChat clients query this catalog at session start to populate slash-command autocomplete menus. AchillesCLI slash commands are provided through a dedicated MCP catalog tool that returns a structured command/sub-command payload and does not execute chat prompts. That catalog tool accepts an optional `dir` argument and uses `achillesAgentLib` skill discovery from that directory to publish argument completions for slash commands that operate on skills. When a discovered skill descriptor contains `## Help`, the catalog publishes that text as the argument completion description for the skill.
5. The webchat interactive mode (`runWebchatInteractive`) accepts ESC (`\x1b`) as a standalone input line to cancel the current prompt execution. This enables remote cancel from browser-based WebChat sessions.
6. The webchat interactive mode may enable generic tag relay only through explicit launch parameters such as `--tag-relay-agent`, `--tag-relay-submit-tool`, `--tag-relay-tags`, and `--tag-relay-list-tool`. AchillesCLI must not assume a concrete downstream relay agent unless the launch context names it, and Ploinky WebChat remains only the envelope and invocation-token transport. When `--tag-relay-tags` is present, AchillesCLI uses that explicit allowlist to preserve unknown-mention fallthrough without a catalog preflight. Tag relay materializes browser attachments only from supported WebChat attachment storage: legacy shared blob ids under the configured shared root and Ploinky session-upload paths under the active WebChat working directory (`uploads/<sessionId>/...`). Cwd-relative session upload paths must stay inside the working directory after realpath resolution, reject traversal, `.secrets`/`*.secrets`, and upload metadata internals, and preserve the same byte caps as other forwarded resources.
7. The Explorer Copilot launcher may consume agent-owned runtime plugin metadata from `file-exp:copilot-launch-extension` to add generic WebChat launch query parameters. AchillesCLI must treat those entries as configuration, not as hard-coded research-agent knowledge; the visible Explorer action remains the normal `Open Copilot here` action.
8. Repository maintenance through `/update repos` runs inside the active AchillesCLI runtime context and updates repositories already cloned under `.achilles-cli/repos/`; hosts must surface aggregated per-repository git pull failures unchanged.
9. In webchat runtime mode, AchillesCLI installs a supervisor that auto-approves loop-session tool calls and emits structured progress lines on stdout. Progress lines use `{"__webchatProgress":1,"type":"tool_reason","tool":"...","reason":"..."}` and must be treated as UI progress metadata, not as assistant answer text.

AchillesIDE interoperability boundary:
1. AchillesIDE documents a broader agent ecosystem with MCP and workspace routing expectations.
2. AchillesCLI documentation must remain explicit about what is native to CLI vs what belongs to IDE/router hosts.
3. Shared conventions (safe user output, debug gating, deterministic command behavior) must remain compatible across ecosystem tools.

Cross-repository invariants:
1. No repository should assume hidden runtime side effects from another without documented contracts.
2. Integration docs must describe boundaries and responsibilities, not duplicate entire external specs.
3. When AchillesAgentLib or host-runtime integration points change, AchillesCLI DS files must be updated in the same change set.

## Conclusion
AchillesCLI is a first-class runtime component inside a larger ecosystem; integration quality depends on explicit boundaries with Ploinky orchestration, AchillesAgentLib runtime semantics, and AchillesIDE interoperability expectations.
