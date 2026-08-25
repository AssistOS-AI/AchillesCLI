---
title: DS010-ecosystem-integration
summary: Defines AchillesCLI boundaries with AchillesAgentLib, Ploinky, WebChat, Soul Gateway, and optional worker agents.
---

## Introduction

This DS owns only contracts that cross from AchillesCLI into another repository or runtime service. Internal command, session, task, model, and skill behavior remains in the DS that owns that subsystem.

## Core Content

| External system | AchillesCLI integration boundary |
| --- | --- |
| AchillesAgentLib | Supplies `MainAgent`, `LLMAgent`, skill discovery, orchestration, and optional AKU APIs; AchillesCLI supplies workspace policy and interface behavior. |
| Ploinky | Starts the agent, provides generated identity, routes MCP calls, activates optional workers, and hosts the dedicated WebChat interface. |
| Soul Gateway | Lists and routes models through authenticated Ploinky paths without exposing provider credentials to the browser. |
| Ploinky WebChat | Sends generic text, command, attachment, workspace-reference, and control envelopes; it does not own AchillesCLI sessions or task persistence. |
| Worker agents | GPTResearcher, Codex Agent, PI Agent, and OpenCode Agent execute provider-specific work and retain their private provider sessions. |

AchillesCLI must use supported AchillesAgentLib imports and must not duplicate its model invocation, skill discovery, or AKU storage internals. Ploinky supplies the one workspace-selected AgentLib source through its runtime mount and package link. AchillesCLI must not declare, install, or clone another copy. Standalone development may expose one explicit checkout through the same package-link contract, and feature modules must not assume a workstation-specific path.

Ploinky integration must use generated agent identity and router-mediated interfaces. AchillesCLI may expose its skill and slash-command catalogs through AgentServer for WebChat discovery, but the browser payload must contain only presentation-safe command, model, session, skill, workspace-file, and task metadata. Credentials, invocation grants, raw provider configuration, and private continuation handles must remain outside browser state.

WebChat envelopes may supply normalized prompt text, safe attachments, workspace-relative references, visibility metadata, and same-origin launch information. AchillesCLI must validate paths against the selected workspace and interpret the request itself. WebChat must not choose provider MCP tools, reconstruct model policy, or persist conversation and task authority independently.

Optional worker agents must remain manual-start integrations and outside the eager AchillesCLI dependency graph. A launcher must check Ploinky runtime state, request activation only when required, wait for readiness, and submit work through the router. Failure to activate one worker must not replace or stop unrelated active routes.

AchillesCLI owns the stable local task id, generic lifecycle journal, visible logs, and continuation action. Each worker owns its execution process, credentials, provider session id, and opaque continuation record. Provider-specific implementation belongs to that worker's documentation; AchillesCLI launcher contracts are limited to safe input mapping, activation, asynchronous submission, and generic result handling.

Explorer may open AchillesCLI WebChat with generic workspace and forwarding hints. Those hints must not encode a provider agent, backend, or MCP tool. Opening WebChat in a folder selects context; it does not by itself create a session artifact, task, skill, or Knowledge Unit.
