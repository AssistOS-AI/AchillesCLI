# achilles-cli - Local Guide

Achilles CLI is the interactive and single-shot skill management CLI used by the AssistOSExplorer workspace. The outer directory is the Ploinky repo; the inner `achilles-cli/` directory is the Ploinky agent.

## Reading order

1. Parent `~/work/file-parser/AssistOSExplorer/CLAUDE.md` for workspace conventions.
2. `docs/specs/matrix.md` and the relevant DS file for the contract you are touching.
3. `achilles-cli/src/cli.mjs` for the trusted Broker entry point and `achilles-cli/src/index.mjs` for the sandboxed agent entry point.
4. `achilles-cli/manifest.json` for the Ploinky agent declaration.
5. `achilles-cli/src/skills/bash/` for the bundled bash skill.

## Scope

- Skill CRUD and execution for the descriptor families registered by AchillesAgentLib.
- Schema validation against `achilles-cli/src/schemas/`.
- Code generation from skill definitions to executable `.mjs`.
- Iterative refinement until tests pass.
- Interactive REPL with history and slash commands.
- Persistent per-workspace enable/disable controls for registered workspace skills.

## Critical components

- `AchillesBroker` stays outside bubblewrap and owns Bash approval prompts and permission state; it does not execute Bash commands.
- `LocalBashExecutor` runs inside the sandboxed MainAgent process, starts Bash children directly, and captures their output as tool results.
- `AchillesCli` runs inside bubblewrap and wraps `RecursiveSkilledAgent` from `achillesAgentLib`, `LLMAgent`, `HistoryManager`, `SlashCommandHandler`, and `ActionReporter`.
- `REPLSession` owns the input loop, history, and ESC cancel.
- `SlashCommandHandler` owns `/ls`, `/read`, `/write`, and skill execution.
- `CommandSelector` owns arrow navigation, filtering, and skill picking.

## Conventions

- Inherits AssistOSExplorer Node 20+, ES module, `.mjs`, and 4-space conventions.
- Built-in skills live in `achilles-cli/src/skills/`.
- LLM invocation goes through `LLMAgent` from `achillesAgentLib`, never direct vendor HTTP.
- The Bash skill contains execution delegation only; the local executor inherits MainAgent's sandbox, while the Broker and `/permissions` own approval policy.

## Testing

- `tests/` at the outer repo root contains integration and test-environment runs.
- Validate skill schema changes against fixtures before refactoring schemas.

## Commit policy

Inherits workspace commit policy. See `~/work/file-parser/CLAUDE.md`.

## Relationship to standalone Achilles CLI

This checkout is the sibling used by the Explorer workspace. Keep schemas and core CLI behavior aligned with the standalone Achilles CLI checkout; divergence between the two checkouts should be intentional and documented.
