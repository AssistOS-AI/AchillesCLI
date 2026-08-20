---
title: DS001-coding-style
summary: Defines AchillesCLI coding, module-ownership, documentation, and verification conventions.
---

## Introduction

This DS is the coding-style authority for AchillesCLI. It governs source organization and contribution quality without redefining runtime behavior owned by specialized specifications.

## Core Content

### Language and module design

Runtime code must use ESM imports and exports. Modules should have one clear responsibility, preserve the naming conventions of their directory, and separate transport, parsing, state, presentation, and policy. Shared behavior should use focused helpers instead of duplicated implementations.

### Source ownership

| Path | Responsibility |
| --- | --- |
| `src/cli.mjs` and `src/broker/` | Trusted startup, workspace confinement, and Bash authorization. |
| `src/index.mjs` | Sandboxed runtime assembly and execution-mode selection. |
| `src/repl/` | Interactive lifecycle, slash-command dispatch, and prompt handling. |
| `src/ui/` | Terminal input and presentation. |
| `src/schemas/` | Skill-document detection and validation. |
| `src/skills/` | Built-in executable skills. |
| `src/lib/` | Reusable state and integration services with narrow contracts. |

Feature modules must not embed workstation-specific paths or call provider SDKs when AchillesAgentLib or an existing integration module owns that concern. Configuration failures must remain explicit, while normal user output must not expose credentials, private prompts, or stack internals.

### Documentation and tests

Persistent documentation must be English, use direct declarative language, and update with any behavior change. DS files must contain only `Introduction` and `Core Content`, must avoid Q&A formatting and list-shaped prose, and must stay within the subject named by the filename.

Tests should live beside the contract surface they verify and use descriptive `.test.mjs` names. Repository integration verification uses `node tests/run-all.mjs`; package behavior uses the relevant tests under `achilles-cli/tests/`. Documentation or source-layout changes must run `fileSizesCheck.sh`; oversized source files are refactoring signals, not permission for unrelated changes.
