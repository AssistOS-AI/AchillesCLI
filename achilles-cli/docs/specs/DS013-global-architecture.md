---
title: DS013-global-architecture
summary: Defines AchillesCLI's top-level components, execution paths, state ownership, and security boundaries.
---

## Introduction

This DS provides the architectural map for AchillesCLI. It names component ownership and cross-component invariants without repeating bootstrap, command, skill, model, or worker-specific contracts.

## Core Content

| Component | Architectural responsibility |
| --- | --- |
| Trusted broker | Resolves the workspace, creates the Bubblewrap boundary, owns Bash permission state, and exposes a narrow authorization channel. |
| Sandboxed runtime | Builds MainAgent, connects model and skill services, restores workspace state, and selects single-shot, REPL, or WebChat operation. |
| Interaction runtime | Converts terminal or WebChat input into slash commands, natural-language prompts, session actions, and task actions. |
| AchillesAgentLib | Provides model-backed planning, skill discovery, and tool execution inside the sandbox. |
| Presentation system | Collects terminal input and renders choices, progress, help, Markdown, and results without owning domain state. |
| Workspace services | Persist settings, conversations, disabled skills, task journals, logs, and optional AKU memory below the selected workspace. |

Slash commands form the deterministic path and must call their named handler or skill without unnecessary model routing. Natural-language input forms the orchestrated path and may let MainAgent select several skills. Both paths share the same workspace, skill catalog, persisted settings, and error boundary.

The broker process must remain outside Bubblewrap and must not execute Bash commands. MainAgent, skill code, the local Bash executor, and approved Bash children must remain inside the persistent sandbox. The selected workspace is the only automatic writable project tree. Network access is shared, so filesystem confinement must not be described as network isolation.

Only Bash requires broker authorization. `ask-for-approval` requires a per-call decision unless MainAgent holds a matching session-local reusable approval; `full-access` skips the prompt but does not widen the sandbox. The untrusted runtime may request a mode change or resolve an interaction only through the one-time trusted control capability. A denial must skip execution and return an ordinary tool result to the planner.

| State owner | Durable state |
| --- | --- |
| Workspace settings | Explicit model, permission mode, selected conversation, and disabled skill names. |
| Conversation store | User and assistant context plus presentation-only records that are excluded from model history. |
| Task store | Stable local task ids, lifecycle state, bounded logs, continuation metadata, and turn ranges. |
| Worker agent | Provider credentials, provider session identifiers, and private continuation records. |
| MainAgent process | Session tier, in-memory execution state, and reusable exact-call approvals. |

Structured WebChat envelopes must remain a transport and presentation protocol. They may report state or carry a control response, but they must not become conversation text or transfer ownership of workspace data to the browser. Detailed behavior belongs to [DS004](specsLoader.html?spec=DS004-entrypoint-runtime-bootstrap.md), [DS005](specsLoader.html?spec=DS005-repl-and-command-processing.md), [DS007](specsLoader.html?spec=DS007-skills-runtime-and-builtins.md), [DS010](specsLoader.html?spec=DS010-ecosystem-integration.md), and [DS012](specsLoader.html?spec=DS012-launch-agent-skills.md).
