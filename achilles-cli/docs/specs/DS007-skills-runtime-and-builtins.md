---
title: DS007-skills-runtime-and-builtins
summary: Defines skill discovery, enablement, execution, mutation, and built-in skill boundaries.
---

## Introduction

This DS owns the runtime lifecycle of skills. Skill-document syntax belongs to DS008, while Bash authorization and external worker implementation belong to their respective architectural and agent specifications.

## Core Content

AchillesAgentLib `MainAgent` must discover and execute skills. AchillesCLI supplies its built-in root, optional CLI roots, supported `node_modules` roots, and Ploinky repository roots under `.ploinky/repos/<repo>/achilles-skills`. Root order must be deterministic, and later external definitions may replace a built-in fallback with the same canonical name.

Repositories added through `/add repo` belong to `<workspace>/.data/achilles-cli/repos/`. That owned root must be validated and registered as an additional workspace skill root at startup and each explicit catalog reload, including when `--dir` selects a nested project. Reload must add new managed skills, remove deleted skills and aliases, and preserve disabled canonical names. Discovery must not scan other agents' private state or AKU storage. Registering this root must not change the selected project directory or widen the project sandbox boundary.

| Skill area | Contract |
| --- | --- |
| Inspection | List and read skills or their sidecar specifications without mutating them. |
| Authoring | Create, update, delete, validate, preview, or scaffold skill artifacts through schema-aware operations. |
| Generation and tests | Generate executable code or tests, run the applicable checks, and refine a skill from their results. |
| Execution | Execute one named skill directly or let natural-language planning select applicable skills. |
| Provider launchers | Submit work to a fixed external worker through the Ploinky-mediated integration contract. |

Skill mutations must trigger an explicit catalog reload. Reloading must preserve deterministic aliases and surface actionable discovery errors. Startup discovers the available roots; later refreshes reload those roots without silently inventing new search locations.

Workspace skills are enabled by default. AchillesCLI may persist only canonical disabled names in `.data/achilles-cli/settings.json`. Disabled skills must remain visible to inspection and enablement commands but must not execute, build, or enter MainAgent and orchestrator tool catalogs. Directory-wide enablement changes must remain confined to the active workspace and resolve to canonical skill names before they reach MainAgent.

The built-in Bash skill must only parse the requested command and call the sandboxed local executor. It must not own approval prompts, reusable approvals, risk classification, or process confinement. Provider launcher skills must similarly own only their public input mapping, target activation, asynchronous submission, and safe result contract; provider-specific sessions and execution internals remain outside AchillesCLI.
