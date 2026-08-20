---
title: DS000-vision
summary: Defines Codex Agent's purpose, supported operating modes, and security boundaries.
---

## Introduction

Codex Agent makes the official OpenAI Codex CLI available as a Ploinky agent. It supports native interactive use and delegated coding tasks whose Codex threads can be continued without exposing provider thread identifiers to AchillesCLI or WebChat.

## Core Content

Codex Agent must let an operator start the installed Codex CLI through `ploinky cli codexAgent`. It must also expose asynchronous `execute-task` and `continue-task` operations for authorized agent-to-agent use.

| Product boundary | Required outcome |
| --- | --- |
| Project access | Codex runs from the supplied project directory with `workspace-write` confinement and no interactive approval path. |
| Task continuity | A reported Codex thread remains continuable through an opaque handle stored in the persistent agent home. |
| Visible output | Agent messages, completed command output, and provider stderr are visible without raw JSON control records or duplicated final output. |
| Provider state | Authentication, configuration, installation, and thread records persist in the agent home and remain private to Codex Agent. |
| Startup | The worker remains manual and starts only for direct use or an explicit delegated task. |

The AchillesCLI launcher must not forward the main conversation model. A direct internal task call may provide an initial model, and a continued turn may provide a task-specific override. The continuation record must never persist the model because later turns must use the new explicit override or the configuration active at continuation time.
