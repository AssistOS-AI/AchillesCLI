---
title: DS003-main-behavior
summary: Defines direct Codex access, resumable delegated coding work, and workspace-confined execution as the agent's primary behaviors.
---

## Introduction

Codex Agent exists so an operator or an authorized orchestrator can use Codex for real coding work while provider state remains private and later turns remain connected to the original task.

## Core Content

### Main Behavior Components

| Name | Explanation |
| --- | --- |
| Direct Codex CLI access | An operator starts the native Codex CLI through Ploinky and uses provider-owned interactive behavior. |
| Resumable delegated coding | AchillesCLI submits asynchronous work, observes live output, and continues the same Codex thread through a stable local task. |
| Workspace-confined execution | Codex may change the supplied project while writes outside that workspace fail without an approval prompt. |

### Direct Codex CLI access

The operator triggers `ploinky cli codexAgent`. Ploinky must run the executable installed in the persistent agent home so interactive login, configuration, and provider behavior remain consistent with delegated tasks. This mode does not create an AchillesCLI background task unless an orchestrator invokes the MCP surface separately.

### Resumable delegated coding

An authorized AchillesCLI launcher supplies a non-empty prompt and project directory to `execute-task`. Codex Agent must start an asynchronous task, stream selected Codex output, return bounded final text, and persist any reported thread behind an opaque handle. A later `continue-task` request must resume that thread in the original directory. AchillesCLI may create a new remote execution for the turn, but it must retain one user-visible local task identifier.

### Workspace-confined execution

Every initial and resumed provider command must apply Codex's `workspace-write` sandbox and `never` approval policy before `exec`. The supplied project directory is the working root. Codex may perform ordinary coding writes there, while operations requiring broader writes must fail rather than prompt, escape the boundary, or silently weaken the sandbox.
