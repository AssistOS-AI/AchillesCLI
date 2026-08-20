---
title: DS004-task-continuation-and-authentication
summary: Defines Codex MCP task inputs, continuation records, cancellation, models, and typed authentication control.
---

## Introduction

The Codex MCP surface is internal to authorized Ploinky agent calls. It must give AchillesCLI generic task controls while keeping Codex-specific threads, project paths, and login state inside Codex Agent.

## Core Content

| Tool or endpoint | Contract |
| --- | --- |
| `execute-task` | Requires a prompt and project directory, accepts an optional initial model, runs asynchronously, retains full logs, and advertises `continue-task`. |
| `continue-task` | Requires an opaque handle and prompt, accepts an optional turn-specific model, and resumes the stored thread asynchronously. |
| `task-session-control` | Performs typed authentication operations against the task's provider session without exposing private records. |
| Models endpoint | Lists the provider models visible to Ploinky through the agent endpoint contract. |

The continuation store must accept only UUID handles, reject symlinked directories or records, write atomically with restrictive modes, and store only the thread identifier and resolved original project directory. It must not persist prompts, models, credentials, task tokens, or router authority.

Codex stdout must be parsed as JSONL. Completed agent-message text and completed command-output text must enter the live task log, provider stderr must remain byte-preserved, and reasoning or lifecycle control records must remain hidden. The last bounded agent message must become `outputText` without being appended a second time to the log.

On `SIGTERM`, the wrapper must abort the provider process. If Codex already reported a thread, the wrapper must preserve it and return the continuation descriptor before exiting unsuccessfully. A task cancelled before Codex creates a thread has no continuation capability.

The worker must remain `startup: manual`, and AchillesCLI must activate it through the status-first Marketplace flow only when an explicit Codex task requires it.
