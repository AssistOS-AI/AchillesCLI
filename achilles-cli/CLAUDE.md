# achilles-cli (inner agent)

Ploinky-agent layer for AchillesCLI under AssistOSExplorer. The outer `../CLAUDE.md` is the local guide; `docs/specs/` has the canonical DS contracts.

## Entry points

- `src/cli.mjs` - trusted outer entry point that creates the Broker and bubblewrap sandbox.
- `src/index.mjs` - sandboxed MainAgent entry point, single-shot vs REPL mode detection, logger config.
- `bin/achilles-cli` - binary wrapper.
- `manifest.json` - Ploinky agent declaration using the shared `docker.io/assistos/ploinky-node:24-bookworm-tools` runtime image.

## Module layout

- `src/skills/` - built-in skills bundled with the CLI.
- `src/broker/` - trusted Bash execution, approval, streaming, and bubblewrap boundary.
- `src/permissions/` - Broker protocol and permission-mode constants.
- `src/repl/` - REPL components for input loop, history, and ESC cancel.
- `src/ui/` - UI components such as `CommandSelector` and `ResultFormatter`.
- `src/lib/` - library helpers.
- `src/schemas/` - JSON schemas for each skill type: `cskill`, `oskill`, `mskill`, `tskill`, and `dcgskill`.
- `scripts/installPrerequisites.sh` - agent install hook.

## Conventions

- All LLM invocation goes through `LLMAgent` from the single `achillesAgentLib` source selected and mounted by Ploinky. Standalone development must expose one explicit checkout through the same package-link contract.
- Built-in skills follow the same `SKILL.md` plus `skill.json` schema as user-authored skills.
- Bash skills only parse and delegate execution. Approval policy belongs to the outer Broker.

## Commit policy

Inherits workspace commit policy. See `~/work/file-parser/CLAUDE.md`.
