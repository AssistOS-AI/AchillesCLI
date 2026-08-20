---
title: DS000-vision
summary: Defines AchillesCLI's purpose, product boundary, and documentation authority.
---

## Introduction

AchillesCLI is a local command-line agent for completing work inside a selected project directory. It can also run through Ploinky and its WebChat interface, while AchillesCLI remains the owner of prompt execution, workspace state, skills, sessions, and delegated-task records.

## Core Content

AchillesCLI must accept natural-language prompts and deterministic slash commands, execute applicable skills through AchillesAgentLib, and return results through single-shot, terminal REPL, or WebChat operation. The selected workspace is the durable scope for settings, conversations, task history, and writable command execution.

The product boundary excludes provider-specific worker implementation. GPTResearcher, Codex Agent, PI Agent, and OpenCode Agent own their provider runtimes and private continuation state. AchillesCLI may activate and call those workers through Ploinky, but it must retain only the generic information needed to present and continue a delegated task.

The runnable package, built-in skills, schemas, UI, and package-local tests belong under `achilles-cli/`. Repository integration tests belong under `tests/`. Operator documentation belongs under `achilles-cli/docs/`, and `achilles-cli/docs/specs/` is the authoritative source for AchillesCLI contracts.

Persistent technical documentation must remain in English and synchronized with behavior changes. Each DS must describe only the contract named by its filename; another DS may reference that contract but must not reproduce its details.
