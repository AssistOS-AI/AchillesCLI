---
title: DS003-main-behavior
summary: Defines direct OpenCode access, resumable sandboxed tasks, and Ploinky provider endpoints as the agent's primary behaviors.
---

## Introduction

OpenCode Agent serves operators, AchillesCLI users, and Ploinky model routing. Its primary behaviors must preserve native OpenCode work while applying task-specific confinement and keeping provider sessions private.

## Core Content

### Main Behavior Components

| Name | Explanation |
| --- | --- |
| Direct OpenCode CLI access | An operator starts the native OpenCode CLI through Ploinky with persistent provider configuration. |
| Resumable sandboxed coding | AchillesCLI submits asynchronous work that can change one project and continue the same private OpenCode session. |
| Ploinky provider endpoints | Ploinky discovers OpenCode models and submits non-streaming chat completions through the agent's OpenAI-compatible handlers. |

### Direct OpenCode CLI access

The operator triggers `ploinky cli opencodeAgent`. Ploinky must run the CLI from the persistent agent home with the repository-managed configuration and provider-owned authentication. Direct use must preserve native OpenCode sessions and recent-model selection.

### Resumable sandboxed coding

An authorized AchillesCLI launcher submits a prompt and project directory to `execute-task`. OpenCode Agent must establish the nested sandbox, run OpenCode asynchronously, preserve native live output, resolve and export the provider session outside that output, and persist the session behind an opaque continuation handle. A later `continue-task` request must reuse the original project and exact provider session while AchillesCLI retains one stable local task identifier.

### Ploinky provider endpoints

The models endpoint must publish exact OpenCode provider/model identifiers with normalized pricing, limits, capability fields, and the `coding-agent` routing tag. The chat-completions endpoint must reject streaming, transform request messages into one prompt, execute through the shared runner in effective `WORKSPACE_PATH`, and return an OpenAI-compatible response without creating a resumable MCP task.
