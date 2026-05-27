# achilles-cli (inner agent)

Ploinky-agent layer for AchillesCLI under AssistOSExplorer. The outer `../CLAUDE.md` is the local guide; `../docs/specs/` has the canonical DS contracts.

## Entry points

- `src/index.mjs` - CLI arg parsing, single-shot vs REPL mode detection, logger config.
- `bin/achilles-cli` - binary wrapper.
- `manifest.json` - Ploinky agent declaration.

## Module layout

- `src/skills/` - built-in skills bundled with the CLI.
- `src/repl/` - REPL components for input loop, history, and ESC cancel.
- `src/ui/` - UI components such as `CommandSelector` and `ResultFormatter`.
- `src/lib/` - library helpers.
- `src/schemas/` - JSON schemas for each skill type: `cskill`, `oskill`, `mskill`, `tskill`, and `dcgskill`.
- `scripts/installPrerequisites.sh` - agent install hook.

## Conventions

- All LLM invocation goes through `LLMAgent` from `achillesAgentLib`, which is workspace-shared at `~/work/file-parser/ploinky/node_modules/achillesAgentLib`.
- Built-in skills follow the same `SKILL.md` plus `skill.json` schema as user-authored skills.

## Commit policy

Inherits workspace commit policy. See `~/work/file-parser/CLAUDE.md`.
