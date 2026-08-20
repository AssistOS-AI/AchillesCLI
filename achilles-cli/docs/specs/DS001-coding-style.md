---
title: DS001-coding-style
summary: Defines coding, runtime, and documentation conventions for all AchillesCLI components.
---

## Introduction
This file is the coding-style authority for AchillesCLI. It defines implementation conventions, runtime discipline, and documentation obligations that apply across CLI, REPL, UI, schema, and skill modules.

## Core Content
### Language and module style
Use ESM imports/exports in runtime modules.

Keep directory-local naming conventions consistent with current files.

Prefer focused modules with explicit responsibilities over large multipurpose files.

Follow SOLID and DRY principles: keep transport, parsing, relay dispatch, and domain-specific policy in separate focused modules, and reuse shared helpers instead of duplicating integration logic.

### Structural conventions
Trusted Broker bootstrap logic remains in `src/cli.mjs`, while sandboxed agent bootstrap and runtime-mode selection remain in `src/index.mjs`.

REPL lifecycle and interactive behavior remain in `src/repl/`.

UI rendering/input helpers remain in `src/ui/`.

Skill contract parsing and schema utilities remain in `src/schemas/`.

Built-in executable skill modules remain in `src/skills/`.

Runtime source remains under `achilles-cli/src/`, root integration tests remain under `tests/`, package-local tests remain under `achilles-cli/tests/`, and workspace-owned durable data remains under the selected workspace's `.achilles-cli/` directory.

### Runtime configuration discipline
Preserve environment-based defaults for runtime config.

Preserve explicit manual override paths for core config and dependency resolution.

Do not hide configuration failures behind silent fallbacks.

### LLM interaction discipline
Route LLM calls through AchillesAgentLib `LLMAgent` and `MainAgent` paths.

Keep tier/model policy centralized and session-aware.

Avoid ad-hoc direct provider SDK calls in feature modules.

### Error handling and observability
Emit clear operational errors for invalid command usage and unsupported flows.

Keep debug-level internals gated by debug flags.

Return user-safe error messages in non-debug paths.

### Skill-system conventions
Keep slash-command paths deterministic and explicit.

Keep natural-language execution routed through orchestration logic.

Keep read/write skill behavior explicit and auditable.

### Achilles integration conventions
AchillesAgentLib is an authorized dependency.

Integration must not assume AchillesAgentLib is always available in the current repo root.

Dependency resolution must use the Ploinky runtime mounts, explicit runtime overrides, parent-path lookup, or supported `node_modules` fallback described by the bootstrap contract; feature modules must not embed workstation-specific absolute paths.

Routing-sensitive work must retain the `documentation`, `specification`, `orchestration`, `bootstrap`, and `testing` task metadata tags defined by DS002.

### Documentation conventions
Persistent documentation remains in English.

DS files use direct specification language and do not use Q&A chapters.

When runtime behavior changes, update DS files and HTML docs in the same change set.

### Verification conventions
Keep tests close to their contract surface and use descriptive `.test.mjs` names.

Run `node tests/run-all.mjs` for repository integration verification and the relevant files under `achilles-cli/tests/` for package-local behavior.

Run `fileSizesCheck.sh` when documentation or source layout changes; reported oversized implementation files are refactoring signals and do not authorize unrelated source changes.
