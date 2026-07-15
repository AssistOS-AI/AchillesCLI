---
id: DS005
title: REPL and Command Processing
status: active
owner: AchillesCLI Maintainers
summary: Defines interactive session behavior, hierarchical command routing, and natural-language processing flow.
---

# DS005-repl-and-command-processing

## Introduction
This DS documents the interactive runtime in `src/repl/`, including session lifecycle, hierarchical command routing, and natural-language execution.

## Core Content
Primary REPL components and responsibilities:
1. `REPLSession.mjs`
   - Owns interactive loop lifecycle.
   - Coordinates input acquisition, execution dispatch, and output rendering.
   - Maintains session-local execution context.
   - Routes all non-slash input directly to the LLM processor.
2. `InteractivePrompt.mjs`
   - Handles prompt capture and line-edit interactions.
   - Provides hierarchical command menu: typing `/` opens the top-level command picker.
   - Commands with sub-options show a secondary menu when selected (e.g., `/list` → `skills`, `repos`).
   - Commands without sub-options complete directly or prompt for skill/argument input.
3. `SlashCommandHandler.mjs`
   - Defines command grammar via `COMMAND_DEFINITIONS` and `SUB_OPTIONS`.
   - Routes deterministic commands to concrete handlers/skills.
   - Enforces argument validation for slash-command entry points.
   - Supports hierarchical commands with sub-options (e.g., `/list skills`, `/add repo`).
   - Supports `/update repos` as a repository maintenance command that runs `git pull` in each cloned repository under `.achilles-cli/repos/`.
4. `NaturalLanguageProcessor.mjs`
    - Routes free-text prompts into orchestrated LLM execution.
    - Applies runtime execution options and context shaping.
    - Captures ESC interruptions and propagates cancellation to MainAgent session runtime.
5. `HistoryManager.mjs`
   - Persists and rehydrates command history.
   - Stores history in `.achilles-cli/history` within the working directory.
   - Supports history navigation and replay behavior.

Command routing model:
1. Inputs beginning with `/` are parsed as command invocations.
2. Commands may have sub-options (e.g., `/list` → `skills`, `repos`). Selecting a command with sub-options opens a secondary menu.
3. Non-slash inputs are processed directly through the natural-language execution path with no fallback to quick commands.
4. Command handlers can trigger skill reload when skill definitions change.
5. Repository update failures must be reported as an aggregated error beginning with `failed to update repos:` followed by one line per failed repository.
6. `/tasks [count|all]` reads the current workspace task journal without invoking an LLM. With no argument it returns the ten most recently updated tasks; a numeric argument must be between 1 and 100, while `all` explicitly requests the complete journal.
7. Task summaries must use the persisted description preview with `toolName` and task id as fallbacks, and must include status, target agent, and update time. Only terminal tasks may include log output, limited to the final five lines and 2 KiB per task.

Hierarchical command structure:
1. Commands with `subOptions` in `COMMAND_DEFINITIONS` show a sub-menu when selected.
2. Sub-options are defined in `SUB_OPTIONS` with their own skill mappings and argument requirements.
3. Commands without sub-options complete directly or prompt for additional input (skill name, text arguments).
4. The command picker (`/`) is the primary discovery mechanism for all available commands.

Session control behavior:
1. REPL session applies the current tier and restores an explicit model selection from `<workspace>/.achilles-cli/settings.json` when present.
2. Cancellation/interruption paths must preserve terminal recoverability.
3. ESC interruption is supported for both natural-language processing and slash-command execution paths.
4. Slash-command execution forwards AbortSignal and interruption intent to skill runtime calls.
5. Context-sensitive help and command selection remain available in interactive mode.
6. Webchat runtime mode (non-TTY stdin) accepts ESC as a standalone line (`\x1b`) to abort the current prompt execution. The agent must respond with `[cancelled]` and resume accepting input.
7. `/model` without arguments opens the terminal search selector. `/model <model-name>` validates the exact name against Soul Gateway and persists it for the workspace; `/tier` removes that explicit selection.
8. In WebChat mode, a successful `/model` or `/tier` change must publish the settings value through generic runtime-state metadata after the settings write completes. The published model must be the value read back from settings, or `null` after `/tier` removes it.

Operational invariants:
1. Deterministic slash flows must avoid unnecessary LLM routing.
2. Natural-language flows must remain explicit about orchestrated execution.
3. REPL errors must be user-readable and must not silently terminate the loop.
4. All commands use slash syntax; there are no quick commands without `/`.
5. Interrupted turns must not be appended to command history.
6. Task inspection must remain read-only. It must not create task storage, change task status, start polling, or detach terminal CLI work.

## Decisions & Questions

### Question #1: Why does `/tasks` use one command path in terminal and WebChat?

Response:
Both runtimes already dispatch deterministic slash commands through `SlashCommandHandler`. Injecting the same workspace task formatter preserves identical filtering, limits, and output while allowing the browser command catalog to discover `/tasks` without a second protocol.

### Question #2: Why is runtime model state published only after settings persistence?

Response:
The browser badge represents the explicit workspace configuration, so the emitted value must not get ahead of the durable setting. Reading the saved value back before publication keeps runtime execution state and the WebChat header aligned even if settings normalization changes later.

## Conclusion
The REPL subsystem is the primary interactive contract for AchillesCLI and must keep deterministic commands, orchestrated prompting, and session-state controls coherent. The hierarchical command model provides uniform discovery and execution through the `/` menu.
