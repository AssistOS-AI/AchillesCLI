---
title: DS000-vision
summary: Defines AchillesCLI mission, boundaries, and the authoritative documentation model.
---

## Introduction
AchillesCLI is a skill-oriented CLI runtime built on AchillesAgentLib and packaged as a Ploinky-ready agent surface. The repository must stay focused on executable runtime behavior and auditable technical contracts, not on detached conceptual narratives.

## Core Content
The repository must preserve these permanent boundaries:
1. `achilles-cli/` contains the runnable package, CLI entrypoint, REPL, UI stack, schemas, and built-in skills.
2. `tests/` contains the executable test harness for runtime and skill flows.
3. `docs/` contains operator-facing HTML documentation.
4. `docs/specs/` contains authoritative DS contracts.

The DS set is authoritative for contracts, invariants, and operational boundaries. HTML pages are explanatory surfaces that must remain synchronized with DS definitions. When drift appears, DS text controls repository intent until code and HTML are realigned.

The project must retain portable skill behavior:
1. Built-in skills are shipped with the CLI package.
2. User and external skills are discovered dynamically from configured roots.
3. Skill bootstrap examples remain inside skill folders when they exist for portability.

The runtime must continue to support two user interaction styles:
1. Deterministic command-driven execution through slash commands.
2. Natural-language orchestration through the LLM path.

The repository output contract remains English-only for persistent technical artifacts.

## Conclusion
AchillesCLI must remain a code-first, contract-documented CLI runtime where DS files define behavior boundaries and every major runtime surface is documented in implementation-backed detail.
