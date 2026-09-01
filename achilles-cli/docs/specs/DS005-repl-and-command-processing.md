---
title: DS005-repl-and-command-processing
summary: Defines interactive input routing, slash commands, conversations, task commands, and cancellation.
---

## Introduction

This DS owns input processing after AchillesCLI has started. It defines how terminal REPL and WebChat inputs become slash-command actions or natural-language turns without redefining model routing, skill schemas, or sandbox construction.

## Core Content

`REPLSession` must coordinate terminal input, dispatch, history, and output. `InteractivePrompt` must provide command discovery and argument selection, while `SlashCommandHandler` remains the shared deterministic command grammar for terminal and WebChat. Input beginning with `/` must use that grammar; other input must enter the natural-language execution path.

| Command area | Required behavior |
| --- | --- |
| Skills and repositories | Commands inspect or mutate the requested artifact and refresh the skill catalog when its contents change. |
| Model and permissions | Commands delegate persistence and enforcement to the model and broker contracts without implementing those policies locally. |
| Conversations | `/session`, `/session new`, and `/session resume <id>` select durable workspace conversations. |
| Tasks | `/tasks` lists durable task state, while `/task view|stop|continue` performs the named lifecycle action. |
| Runtime control | Help, status, debug, reload, version, and cancellation remain deterministic operations. |

Conversation records must live under `<workspace>/.data/achilles-cli/sessions/`, with `currentSessionId` stored in the shared settings object. A selected conversation must hydrate a fresh MainAgent exactly once before its next natural-language prompt. Visible WebChat slash commands may be stored as presentation records with `context: false`; invisible UI controls and interaction responses must not enter conversation history.

Task commands must use the AchillesCLI-owned journal under `.data/achilles-cli/tasks/`. `/tasks` and `/task view` are read-only. `/task stop` may cancel only the stored remote task, and `/task continue` may use only the stored target, continuation tool, and opaque handle. Continuation keeps the local task id while adding a new turn and appending the user's prompt before provider output.

WebChat input must pass structured approval responses to the pending broker interaction before ordinary dispatch. Session, task, skill, model, and workspace-file envelopes are presentation metadata and must not become assistant text. Visible composer commands may return visible text; invisible controls must return only the structured state needed by the browser.

Prompt dispatch must be serial and recover after a failed turn. Best-effort post-turn skill refresh must not permanently block the queue. ESC must cancel the active natural-language or slash-command execution, return the interface to a usable state, and avoid recording an interrupted terminal command as successful history.

The command catalog must expose only valid subcommands and action-compatible arguments. Disabled skills must remain selectable for enablement but must be absent from executable skill completions. Saved sessions and tasks should display readable labels while inserting their opaque identifiers.
