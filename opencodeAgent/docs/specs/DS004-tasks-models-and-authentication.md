---
title: DS004-tasks-models-and-authentication
summary: Defines OpenCode MCP tools, continuation, model selection, authentication, installation, and readiness.
---

## Introduction

OpenCode Agent exposes internal task controls and provider endpoints that share one installation and persistent provider home. The contracts must remain compatible without confusing task sessions with chat-completions requests.

## Core Content

| Tool or endpoint | Contract |
| --- | --- |
| `execute-task` | Requires prompt and project directory, accepts an optional model, runs asynchronously with full retained logs, and advertises continuation. |
| `continue-task` | Requires an opaque handle and prompt, accepts an optional model, and resumes the exact stored OpenCode session asynchronously. |
| `task-session-control` | Performs typed provider authentication operations against private task state. |
| Models endpoint | Lists exact OpenCode model identifiers and maps provider metadata to Ploinky descriptors. |
| Chat-completions endpoint | Accepts a non-streaming OpenAI request, requires an OpenCode model identifier, and runs the shared provider policy in `WORKSPACE_PATH`. |

Initial tasks must use an unpredictable internal title so session discovery can match both title and resolved project without selecting concurrent work. The worker may fall back to a read-only query of OpenCode's persisted database when session listing cannot run in the selected proc mode. Neither lookup output nor exported session JSON may enter task logs.

Continuation must use an explicit authorized model override when supplied. Otherwise it must read the first valid recent provider and model plus a non-default variant from OpenCode's persistent state immediately before execution. Missing or malformed state must preserve native resume behavior.

The worker must remain `startup: manual`. Its install profile must install the current CLI, validate the managed configuration, and atomically replace only that configuration file. Readiness must prove the nested sandbox guard and launch the real OpenCode binary through the chosen proc mode.
