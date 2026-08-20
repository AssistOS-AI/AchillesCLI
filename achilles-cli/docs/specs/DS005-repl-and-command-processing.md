---
title: DS005-repl-and-command-processing
summary: Defines interactive session behavior, hierarchical command routing, and natural-language processing flow.
---

## Introduction
This DS documents the interactive runtime in `src/repl/`, including session lifecycle, hierarchical command routing, and natural-language execution.

## Core Content
Primary REPL components and responsibilities:
`REPLSession.mjs`

Owns interactive loop lifecycle.

Coordinates input acquisition, execution dispatch, and output rendering.

Maintains session-local execution context.

Routes all non-slash input directly to the LLM processor.

`InteractivePrompt.mjs`

Handles prompt capture and line-edit interactions.

Provides hierarchical command menu: typing `/` opens the top-level command picker.

Commands with sub-options show a secondary menu when selected (e.g., `/list` → `skills`, `repos`).

Commands without sub-options complete directly or prompt for skill/argument input.

`SlashCommandHandler.mjs`

Defines command grammar via `COMMAND_DEFINITIONS` and `SUB_OPTIONS`.

Routes deterministic commands to concrete handlers/skills.

Enforces argument validation for slash-command entry points.

Supports hierarchical commands with sub-options (e.g., `/list skills`, `/add repo`).

Supports `/update repos` as a repository maintenance command that runs `git pull` in each cloned repository under `.achilles-cli/repos/`.

Supports `/session`, `/session new`, and `/session resume <session-id>` through the same handler in terminal and WebChat modes.

`NaturalLanguageProcessor.mjs`

Routes free-text prompts into orchestrated LLM execution.

Applies runtime execution options and context shaping.

Captures ESC interruptions and propagates cancellation to MainAgent session runtime.

`HistoryManager.mjs`

Persists and rehydrates command history.

Stores history in `.achilles-cli/history` within the working directory.

Supports history navigation and replay behavior.

`ConversationSessionStore.mjs`

Owns durable natural-language conversations under `.achilles-cli/sessions/`.

Keeps `currentSessionId` in `.achilles-cli/settings.json` beside model and permissions.

Uses validated UUID file names, safe directory checks, and atomic JSON replacement.

`workspaceTasks.mjs` and `webchatBackgroundTasks.mjs`

Own workspace task metadata and logs under `.achilles-cli/tasks/` in every runtime mode.

Observe newly detached AgentServer tasks, reattach ongoing tasks after process startup, and poll them through the router-mediated task-status contract.

Implement listing, full-log viewing, remote cancellation, and continuation without delegating task state to WebChat.

Command routing model:
Inputs beginning with `/` are parsed as command invocations.

Commands may have sub-options (e.g., `/list` → `skills`, `repos`). Selecting a command with sub-options opens a secondary menu.

Non-slash inputs are processed directly through the natural-language execution path with no fallback to quick commands.

Command handlers can trigger skill reload when skill definitions change.

Repository update failures must be reported as an aggregated error beginning with `failed to update repos:` followed by one line per failed repository.

`/tasks [count|all]` reads the current workspace task journal without invoking an LLM. With no argument it returns the ten most recently updated tasks; a numeric argument must be between 1 and 100, while `all` explicitly requests the complete journal.

Task summaries must use the persisted description preview with `toolName` and task id as fallbacks, and must include status, target agent, and update time. Only terminal tasks may include log output, limited to the final five lines and 2 KiB per task.

`/session` is the single conversation-session command. It opens or refreshes a selector containing `New` and saved sessions; `/session new` creates and selects a session, while `/session resume <session-id>` loads and selects an existing one.

`/task view <task-id>` reads the complete stored log, `/task stop <task-id>` cancels the current remote task, and `/task continue <task-id> <prompt>` starts another remote execution through the stored generic continuation capability. Continuation must append each submitted prompt line to the durable task log with a `you> ` prefix before provider output, without a synthetic `[Continuation <turn>]` label, publish that log delta with its resulting offset, and preserve the journal metadata ranges for every earlier final answer.

`/task` autocomplete must first expose `view`, `continue`, and `stop`, then show action-compatible task names while inserting the opaque local task id. `stop` lists only ongoing tasks; `continue` lists only terminal tasks carrying a continuation handle.

`/skills` returns every registered skill below the active working directory, including disabled records. `/skill enable|disable <skill-name>` changes one canonical skill, while `/skills enable|disable <relative-directory>` changes every registered descendant of a workspace-confined directory.

The structured slash catalog must exclude persisted disabled skills from executable skill arguments such as `/exec`, while `/skill enable` must continue to offer the complete catalog so disabled skills can be restored.

Hierarchical command structure:
Commands with `subOptions` in `COMMAND_DEFINITIONS` show a sub-menu when selected.

Sub-options are defined in `SUB_OPTIONS` with their own skill mappings and argument requirements.

Commands without sub-options complete directly or prompt for additional input (skill name, text arguments).

The command picker (`/`) is the primary discovery mechanism for all available commands.

Session control behavior:
REPL session applies the current tier, while startup restores the explicit model and Bash permission mode from `<workspace>/.achilles-cli/settings.json` when present.

Cancellation/interruption paths must preserve terminal recoverability.

ESC interruption is supported for both natural-language processing and slash-command execution paths.

Slash-command execution forwards AbortSignal and interruption intent to skill runtime calls.

Context-sensitive help and command selection remain available in interactive mode.

Webchat runtime mode (non-TTY stdin) accepts ESC as a standalone line (`\x1b`) to abort the current prompt execution. The agent must respond with `[cancelled]` and resume accepting input.

`/model` without arguments opens the terminal search selector. `/model <model-name>` validates the exact name against Soul Gateway and persists it for the workspace; `/tier` removes that explicit selection.

In WebChat mode, a successful `/model` or `/tier` change must publish the settings value through generic runtime-state metadata after the settings write completes. The published model must be the value read back from settings, or `null` after `/tier` removes it.

`/permissions` without arguments reports the current workspace Bash mode; `/permissions ask-for-approval` and `/permissions full-access` change it through the broker's trusted control channel and persist the confirmed mode for that workspace.

The WebChat slash-command catalog must advertise `ask-for-approval` and `full-access` as argument completions for `/permissions`, in that order, so the browser can present both supported modes without treating them as conversation text.

In WebChat, a Bash approval request keeps the current execution suspended while AchillesCLI emits a structured interaction with a unique request id and the ordered choices `always-allow`, `allow`, and `deny`; `always-allow` is the default choice.

A structured WebChat interaction response must be consumed as control input before slash-command and prompt dispatch, must match the pending request id, and must never enter agent conversation history.

Resolving the interaction resumes the same tool call with the command result or denial; a second or stale response must not execute the command again.

Natural-language turns must be persisted as user plus assistant records. A WebChat slash command submitted visibly through the composer must also be persisted with its visible response as presentation-only records marked `context: false`; those records render after refresh but never enter MainAgent `initialHistory`. A task started by that command must be inserted as a separate task item in the same ordered session. Slash commands sent invisibly by WebChat UI controls and structured interaction responses must not create conversation records or emit textual acknowledgements and errors into the main chat stream; their structured control envelopes remain available to the originating UI.

Switching sessions must create a fresh MainAgent, load the selected transcript for one-time `initialHistory`, and reset session-local tier state while preserving workspace model and permission settings.

WebChat mode must publish `current`, `list`, and `selected` session records through version-1 `__webchatSession` envelopes. `/session`, `/session new`, and `/session resume <id>` remain ordinary SlashCommandHandler operations; the browser does not receive a separate session API.

The WebChat slash-command catalog must expose no `/sessions` alias. Its `/session resume` subcommand must provide saved sessions as argument completions whose inserted value is the opaque `sessionId` and whose visible label is the session preview, allowing selection without exposing ids as the only human-readable identifier.

WebChat prompt dispatch must use a serial queue that recovers from a rejected previous turn before starting the next input. Post-turn workspace-skill refresh is best-effort maintenance: errors must be logged without rejecting the queue, and a refresh that does not settle within five seconds must stop gating subsequent prompts.

WebChat skill commands must publish version-1 `__webchatSkills` snapshots containing only canonical names, display names, descriptor-family labels, enabled state, and paths relative to the working directory.

Operational invariants:
Deterministic slash flows must avoid unnecessary LLM routing.

Natural-language flows must remain explicit about orchestrated execution.

REPL errors must be user-readable and must not silently terminate the loop.

All commands use slash syntax; there are no quick commands without `/`.

Interrupted turns must not be appended to command history.

`/tasks` and `/task view` must remain read-only. `/task stop` and `/task continue` are the only task-mutating slash actions and must resolve target agent, remote task id, tool name, and opaque continuation handle exclusively from AchillesCLI-owned storage.

Permission mode must be persisted under the `permissions` key in the same workspace settings file as the explicit model selection. The settings file is an unversioned JSON object and must not emit a `version` property. Writes must preserve unrelated settings and remove a legacy `version` property when present.

`full-access` remains confined to the selected workspace; neither that mode nor an approval permits Bash execution outside Bubblewrap.

Reusable exact-call approvals created by `always allow` remain session-local and must not be written to workspace settings.

`currentSessionId` must be preserved in the same unversioned settings object as `model` and `permissions`.

Emitting or persisting an assistant response must not leave the WebChat prompt queue permanently pending or rejected. The runtime must clear its processing and abort-controller state even when post-turn maintenance fails or times out.

Local task status vocabulary must remain `ongoing`, `finished`, `stopped`, and `error`. Provider queue vocabulary, including `queued`, remains in `remoteStatus`; protocol event names such as `started`, `reattached`, and `update` must not be treated as statuses.

The workspace settings object may persist `disabledSkills` as canonical names. Missing state means every discovered workspace skill is enabled, and writes must preserve model, permission, and current-session settings.

### Rationale and Boundaries

Both runtimes already dispatch deterministic slash commands through `SlashCommandHandler`. Injecting the same workspace task formatter preserves identical filtering, limits, and output while allowing the browser command catalog to discover `/tasks` without a second protocol.

The browser badge represents the explicit workspace configuration, so the emitted value must not get ahead of the durable setting. Reading the saved value back before publication keeps runtime execution state and the WebChat header aligned even if settings normalization changes later.

Approval is runtime control, not conversation content. A dedicated interaction lets the browser present bounded choices while the original broker request remains pending, keeps the decision out of history and planner context, and correlates the response to exactly one command without ending the active turn.

The mode is an explicit workspace preference and `full-access` still remains inside the workspace sandbox. Exact-call approvals suppress repeated prompts for one command but do not widen filesystem access, so they remain ephemeral session state rather than workspace configuration.

Command history supports terminal navigation and includes deterministic slash commands. Durable conversation sessions distinguish semantic model context from presentation records: visible WebChat commands and their responses may be mirrored into the session with `context: false`, while `initialHistory` filters those records and task items out. This restores the browser transcript without polluting later MainAgent context or replacing terminal command-history navigation.

The assistant result and conversation record are already complete before final maintenance runs. A rejected or indefinitely pending refresh must not poison the serialized prompt chain and prevent later messages from reaching MainAgent. Keeping the queue recoverable and limiting only this post-turn maintenance wait preserves ordered prompts while allowing refresh failures to remain observable through logs.

AchillesCLI can be launched in terminal REPL, single-shot, or WebChat mode. Keeping the journal, log ingestion, reattachment, stop, and continuation logic inside AchillesCLI gives each mode the same task lifecycle, while WebChat remains a generic command and presentation surface.

The prompt belongs to the continued task's execution timeline and must stay next to the provider output it caused. Persisting and publishing it from AchillesCLI keeps terminal and WebChat task inspection consistent, while suppressing the invisible `/task continue` acknowledgement prevents task controls from becoming unrelated messages in the main conversation.
