---
title: DS012-launch-agent-skills
summary: Defines router-mediated provider launchers and visible RoboTeam task skills.
---

## Introduction

This DS is the single AchillesCLI contract for skills that delegate work to GPTResearcher, Codex Agent, PI Agent, OpenCode Agent, or RoboTeam. Provider installation, authentication, sandboxing, model selection, output parsing, private sessions, robots, and graphical containers belong to each target agent's own specifications.

## Core Content

Every launcher must map a user request to one fixed Ploinky worker and one fixed internal MCP operation. The launcher must use Ploinky `AgentMcpClient` through the router, inspect Marketplace state, activate the worker in global mode only when it is not already running, wait for readiness, and submit the work asynchronously. Direct worker ports, local provider execution, and fallback paths outside Ploinky are not permitted.

| Launcher | Input and delegated operation |
| --- | --- |
| `launch-gpt-researcher` | Accepts plain query text or supported research JSON, starts SearchAgent before GPTResearcher when required, and calls `start_research` with the active workspace. |
| `launch-codex` | Accepts literal non-empty task text and calls `codexAgent.execute-task` with `prompt` and the active `projectDir`. |
| `launch-pi` | Accepts literal non-empty task text and calls `piAgent.execute-task` with `prompt` and the active `projectDir`. |
| `launch-opencode` | Accepts literal non-empty task text and calls `opencodeAgent.execute-task` with `prompt` and the active `projectDir`. |
| `list-robots` | Calls the internal `roboTeamAgent.robot_list` tool and returns workspace robot names, specializations, and run states. |
| `launch-robot` | Accepts a Desktop or Browser mode, robot name, and task; submits the matching native asynchronous RoboTeam start tool with the active workspace as `cwd`; registers it with the background-task observer; and returns the live authenticated Selkies link when the graphical runtime is ready. |

Coding launchers must treat JSON-shaped or model-shaped text as literal task content. They must resolve `projectDir` from the active MainAgent workspace and must not inherit AchillesCLI's conversation model. GPTResearcher may additionally accept `context`, `reportType`, and `useLocalDocs`, but the caller must not replace the workspace selected by AchillesCLI.

RoboTeam calls must use `AgentMcpClient` through the Router and the target's internal workspace-agent tools; no delegated user identity is required because robots belong to the workspace. `launch-robot` must accept only Desktop and Browser modes, must not accept a replacement cwd, and may forward only the supported coding-agent, model, and skill-set hints. The skill must submit the native asynchronous start through `callToolWithoutWait`, which transfers its Ploinky task metadata to AchillesCLI's background-task observer. It must poll the returned native task status only to detect failure while it waits for `getSessionUrlForRobotDesktop` or `getSessionUrlForRobotBrowser` to return the ready GUI link. The observer must continue polling task status, ingesting live ALA logs, and recording the terminal result after `launch-robot` returns. WebChat must show those logs in the collapsible task card and route the returned GUI link to its right panel. RoboTeam may replace the retained GUI container when its mode or cwd differs from the queued task.

Desktop and Browser start tools must advertise RoboTeam's internal `resumeTaskForRobot` continuation tool. Cancellation must return an opaque handle for the exact interrupted graphical request. AchillesCLI must store that handle through its generic task continuation contract and must never decode it. WebChat may present generic `Stop` and `Resume` actions from task status and continuation metadata, but it must not hardcode RoboTeam's agent identity or tool names. Stop must use the native task-cancellation path. Resume must invoke `/task continue` so `webchatBackgroundTasks` calls `resumeTaskForRobot` through Router-mediated internal MCP and attaches the returned native task to the existing local task id. RoboTeam owns workstation preservation, queue pausing, exact handle validation, original-prompt reconstruction, fresh screen observation, and queue release.

An explicit request naming Codex, PI, or OpenCode may select the matching launcher before generic reasoning. A provider name mentioned without task intent must remain ordinary conversation input. Research delegation may be selected through its launcher command or a clear request for GPTResearcher.

A detached call must return `Task started.` and transfer remote task metadata to the AchillesCLI task observer. AchillesCLI may persist the stable local task id, target, status, visible log, generic continuation capability, and opaque handle. Worker credentials, provider session ids, private model state, execution commands, and replacement project authority must remain with the worker.

`/task continue` must call only the continuation operation and opaque handle recorded for that task. Each continued turn may create a new remote task while AchillesCLI retains the same local task id. A turn-specific model override may be forwarded only when the worker contract supports it; it must not become permanent continuation state.

Lifecycle failures may expose an allowlisted stable code and safe explanation. Launchers must not expose command lines, environment values, credentials, hidden routing state, raw provider diagnostics, or inferred continuation state. Worker-specific behavior remains authoritative in the [GPTResearcher](../../GPTResearcher/docs/specsLoader.html?spec=matrix.md), [Codex Agent](../../codexAgent/docs/specsLoader.html?spec=matrix.md), [PI Agent](../../piAgent/docs/specsLoader.html?spec=matrix.md), [OpenCode Agent](../../opencodeAgent/docs/specsLoader.html?spec=matrix.md), and [RoboTeam](../../roboTeamAgent/docs/specsLoader.html?spec=matrix.md) specifications.
