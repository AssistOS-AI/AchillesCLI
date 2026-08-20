---
title: DS002-runtime-architecture
summary: Defines Codex Agent's Ploinky interfaces, Codex process execution, generated-local routing, and persistent state.
---

## Introduction

Codex Agent combines a direct CLI entry, asynchronous MCP tools, a provider process wrapper, a models endpoint, and persistent agent-home state. The architecture must keep the generic Ploinky task contract separate from Codex thread details.

## Core Content

| Component | Responsibility |
| --- | --- |
| Manifest CLI | Starts the installed `$HOME/.local/bin/codex` for direct operator use. |
| AgentServer tools | Accept initial, continued, and typed authentication requests from authorized agents. |
| Codex runner | Builds secure CLI arguments, starts Codex in the project directory, parses JSONL, and forwards selected live output. |
| Continuation store | Maps an opaque UUID handle to a Codex thread identifier and original project directory. |
| Login flow store | Keeps provider authentication flows scoped to the private agent home. |
| Models endpoint | Returns the model catalog available to Ploinky without exposing provider credentials. |

Initial tasks must run `codex exec --json` without ephemeral mode so Codex can create a durable thread. Global options must select `workspace-write` and `never` approval before the `exec` command. Continued tasks must invoke `codex exec resume` with the stored thread and original directory.

Generated-local mode must configure the fixed Router path to Soul Gateway only when both the Router URL and agent API key carry generated provenance. Partial or invalid generated identity must fail before Codex starts. Outside generated-local mode, Codex must use its provider-owned login or supported environment.

The Ploinky agent home must persist the installed executable, provider configuration, authentication state, and private continuation records. The project directory remains the only provider working root supplied by the task request and must not be stored in browser-visible task data.
