---
title: DS000-vision
summary: Defines AchillesCLI mission, boundaries, and the authoritative documentation model.
---

## Introduction
AchillesCLI is a skill-oriented CLI runtime built on AchillesAgentLib and packaged as a Ploinky-ready agent surface. The repository must stay focused on executable runtime behavior and auditable technical contracts, not on detached conceptual narratives.

## Core Content
The repository must preserve these permanent boundaries:
`achilles-cli/` contains the runnable package, CLI entrypoint, REPL, UI stack, schemas, and built-in skills.

`tests/` contains the executable test harness for runtime and skill flows.

`docs/` contains operator-facing HTML documentation.

`docs/specs/` contains authoritative DS contracts.

The DS set is authoritative for contracts, invariants, and operational boundaries. HTML pages are explanatory surfaces that must remain synchronized with DS definitions. When drift appears, DS text controls repository intent until code and HTML are realigned.

The project must retain portable skill behavior:
Built-in skills are shipped with the CLI package.

User and external skills are discovered dynamically from configured roots.

Skill bootstrap examples remain inside skill folders when they exist for portability.

The runtime must continue to support two user interaction styles:
Deterministic command-driven execution through slash commands.

Natural-language orchestration through the LLM path.

The repository output contract remains English-only for persistent technical artifacts.
