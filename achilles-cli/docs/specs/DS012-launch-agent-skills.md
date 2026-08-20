---
title: DS012-launch-agent-skills
summary: Defines the shared launch, activation, task, and continuation contract for external agents.
---

## Introduction

This DS is the single AchillesCLI contract for launcher skills that delegate work to GPTResearcher, Codex Agent, PI Agent, and OpenCode Agent. Provider installation, authentication, sandboxing, model selection, output parsing, and private sessions belong to each worker's own specifications.

## Core Content

Every launcher must map a user request to one fixed Ploinky worker and one fixed internal MCP operation. The launcher must use Ploinky `AgentMcpClient` through the router, inspect Marketplace state, activate the worker in global mode only when it is not already running, wait for readiness, and submit the work asynchronously. Direct worker ports, local provider execution, and fallback paths outside Ploinky are not permitted.

| Launcher | Input and delegated operation |
| --- | --- |
| `launch-gpt-researcher` | Accepts plain query text or supported research JSON, starts SearchAgent before GPTResearcher when required, and calls `start_research` with the active workspace. |
| `launch-codex` | Accepts literal non-empty task text and calls `codexAgent.execute-task` with `prompt` and the active `projectDir`. |
| `launch-pi` | Accepts literal non-empty task text and calls `piAgent.execute-task` with `prompt` and the active `projectDir`. |
| `launch-opencode` | Accepts literal non-empty task text and calls `opencodeAgent.execute-task` with `prompt` and the active `projectDir`. |

Coding launchers must treat JSON-shaped or model-shaped text as literal task content. They must resolve `projectDir` from the active MainAgent workspace and must not inherit AchillesCLI's conversation model. GPTResearcher may additionally accept `context`, `reportType`, and `useLocalDocs`, but the caller must not replace the workspace selected by AchillesCLI.

An explicit request naming Codex, PI, or OpenCode may select the matching launcher before generic reasoning. A provider name mentioned without task intent must remain ordinary conversation input. Research delegation may be selected through its launcher command or a clear request for GPTResearcher.

A detached call must return `Task started.` and transfer remote task metadata to the AchillesCLI task observer. AchillesCLI may persist the stable local task id, target, status, visible log, generic continuation capability, and opaque handle. Worker credentials, provider session ids, private model state, execution commands, and replacement project authority must remain with the worker.

`/task continue` must call only the continuation operation and opaque handle recorded for that task. Each continued turn may create a new remote task while AchillesCLI retains the same local task id. A turn-specific model override may be forwarded only when the worker contract supports it; it must not become permanent continuation state.

Lifecycle failures may expose an allowlisted stable code and safe explanation. Launchers must not expose command lines, environment values, credentials, hidden routing state, raw provider diagnostics, or inferred continuation state. Worker-specific behavior remains authoritative in the [GPTResearcher](../../GPTResearcher/docs/specsLoader.html?spec=matrix.md), [Codex Agent](../../codexAgent/docs/specsLoader.html?spec=matrix.md), [PI Agent](../../piAgent/docs/specsLoader.html?spec=matrix.md), and [OpenCode Agent](../../opencodeAgent/docs/specsLoader.html?spec=matrix.md) specifications.
