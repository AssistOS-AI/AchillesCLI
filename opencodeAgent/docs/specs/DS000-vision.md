---
title: DS000-vision
summary: Defines OpenCode Agent's coding-task, continuation, provider-endpoint, and security outcomes.
---

## Introduction

OpenCode Agent makes the OpenCode CLI available as a Ploinky worker. It supports native CLI use, resumable delegated coding tasks, and OpenAI-compatible model and chat-completions endpoints while keeping each delegated task confined to one project.

## Core Content

OpenCode Agent must expose the installed CLI through `ploinky cli opencodeAgent`, internal asynchronous task tools for AchillesCLI, a models endpoint for Ploinky discovery, and a non-streaming chat-completions endpoint for provider routing.

| Product boundary | Required outcome |
| --- | --- |
| Project access | Delegated OpenCode processes may write only the canonical selected project and required provider state. |
| Continuity | A discovered OpenCode session remains resumable through an opaque handle after completion, supported failure, or controlled cancellation. |
| Visible output | Native provider output remains visible, while session discovery, export data, and structured-result duplication remain hidden. |
| Provider endpoints | Model discovery preserves exact OpenCode model identifiers, and chat completions run in effective `WORKSPACE_PATH`. |
| Credentials | Raw Ploinky and provider secrets remain outside the nested task environment and continuation records. |

The installed OpenCode permission policy must allow non-interactive work while denying external-directory access. This application policy must be reinforced by a task-local Bubblewrap namespace rather than treated as the only filesystem boundary.
