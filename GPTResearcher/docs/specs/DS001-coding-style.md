---
title: DS001-coding-style
summary: Defines source layout, coding conventions, security rules, and test organization for GPTResearcher.
---

## Introduction

GPTResearcher combines Python research adapters, Node.js settings tools, shell lifecycle scripts, and an IDE settings plugin. Changes must preserve clear ownership between these runtimes and keep configuration behavior testable without starting external providers.

## Core Content

Python modules under `scripts/gpt_researcher_agent/` must keep research execution, settings normalization, Soul Gateway adaptation, SearchAgent adaptation, workspace path handling, and JSON I/O in separate modules. The `start-research.py` entry point must remain a thin adapter that parses one request and delegates the research operation.

Node.js files must use ES modules and four-space indentation. Settings commands must exchange JSON through standard input and standard output, while diagnostic text belongs on standard error. Shell scripts must fail on command errors and must resolve installed runtime paths consistently with the manifest.

| Concern | Contract |
| --- | --- |
| Secrets | Source files, settings JSON, logs, and reports must not persist provider keys or Ploinky credentials. |
| Paths | Workspace paths must be canonicalized and confined before files are read or written. |
| Settings | Missing or malformed optional settings must normalize to declared defaults. |
| Output | Tool output must remain machine-readable JSON and diagnostics must remain bounded. |
| Tests | Node behavior belongs under `test/*.test.mjs`; Python adapters should expose deterministic functions that tests can invoke without real providers. |

The repository-level `fileSizesCheck.sh` must include `GPTResearcher/docs` when documentation size and line-flow checks run. Documentation and specification prose must remain unwrapped in source. Tests must cover generated-local fail-closed behavior, settings persistence, SearchAgent provider forwarding, and model-listing boundaries whenever those contracts change.
