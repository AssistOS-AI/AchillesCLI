---
id: DS012
title: OpenCode Launcher Delegation
status: active
owner: AchillesCLI Maintainers
summary: Defines the contract for delegating AchillesCLI tasks to the OpenCode Ploinky agent.
---

# DS012-opencode-launcher-delegation

## Introduction
This DS defines the bounded OpenCode launcher delegation contract implemented
by the `launch-opencode` C-Skill. The feature exists to let AchillesCLI route a
plain user task to the known `opencodeAgent` Ploinky agent without turning
general chat handling into an unrestricted agent invocation surface.

## Core Content
The public skill input must be plain task text. The target agent is not part of
the public grammar. The skill must reject missing task text before making any
MCP request.

The fixed target is `opencodeAgent`, and the fixed MCP tool is `execute-task`.
The `copilot-router` oskill resolves explicit `opencode` or `opencodeAgent`
user requests to `launch-opencode` so users do not provide agent names as skill
input. The skill must not shell out to OpenCode or any other provider command
directly.

The delegated MCP payload must include `prompt`, `projectDir`, and `model`,
because `opencodeAgent.execute-task` requires that schema. `prompt` is the task
description. `projectDir` comes from `invocation.mainAgent.startDir`, the
AchillesCLI session working directory. `model` is hardcoded to
`xai/grok-4.20-0309-non-reasoning`.

The skill returns plain text only. Successful runs return
`OpenCode task completed.` and append bounded final OpenCode output when the
agent returns it. Failed runs return the agent error text or an MCP failure
message.

The call path must remain Ploinky-mediated. When the AchillesCLI runtime has
agent credentials and the bundled Ploinky agent client is available, the skill
may use that client so agent assertions and router policy decide authorization.
When running from WebChat context without direct agent-client access, it may use
the AchillesCLI MCP helper with the current invocation token. In both cases,
the router remains the public and authorization boundary.

The `copilot-router` oskill must select `launch-opencode` before the more
general execution-provider launchers when the user explicitly asks for
`opencode` or `opencodeAgent`. This keeps named-provider intent from being
captured by generic Open Interpreter routing.

The AchillesCLI Ploinky manifest must enable `copilot-agents/opencodeAgent
global` as a blocking dependency so the OpenCode agent runs against the same
workspace as Copilot.

## Decisions & Questions
### Question #1: Why is the launcher fixed to OpenCode instead of accepting any agent name?
Response: External agent invocation is a security-sensitive Ploinky surface.
This launcher supports only `opencodeAgent` so that the payload mapping, tool
name, policy expectations, and user-facing routing semantics remain auditable.
Additional agents require separate launchers or an explicitly designed generic
caller with its own security contract.

### Question #2: Why is the model not part of the public input?
Response: The requested user interface is intentionally minimal:
task description only. The model is fixed to
`xai/grok-4.20-0309-non-reasoning` so the launcher behavior is stable and does
not depend on session or environment model configuration.

## Conclusion
OpenCode delegation in AchillesCLI is a narrow provider launcher. It lets users
explicitly ask for OpenCode work while preserving Ploinky router mediation,
fixed tool dispatch, deterministic argument mapping, and plain text results.
