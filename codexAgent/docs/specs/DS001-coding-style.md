---
title: DS001-coding-style
summary: Defines module boundaries, JavaScript conventions, secure process handling, and tests for Codex Agent.
---

## Introduction

Codex Agent is an ES-module Node.js package composed of task entry points, a Codex process runner, private continuation storage, authentication controls, model discovery, and an installation profile. Changes must keep these responsibilities separate and independently testable.

## Core Content

JavaScript files must use ES modules, four-space indentation, explicit imports, and small exported functions for deterministic argument construction, event parsing, storage validation, and login-state transitions. Entry points must parse one JSON request from standard input, write one structured result to standard output, and reserve standard error for visible provider or diagnostic text.

| Concern | Contract |
| --- | --- |
| Process arguments | Global Codex security flags must precede `exec`, and tests must assert initial and resumed argument ordering. |
| Output parsing | JSONL parsing must be incremental and must not expose raw control events or reasoning items. |
| Persistent files | Continuation and login records must use restrictive permissions, atomic replacement, UUID identifiers, and symlink rejection. |
| Cancellation | Task wrappers must handle `SIGTERM`, abort Codex, and preserve an observed thread before exit when possible. |
| Tests | Provider execution, installation, login parsing, failure continuation, cancellation, and generated-local routing belong under `test/*.test.mjs`. |

The installer must use an explicit npm CLI path selected for the runtime, install under `$HOME/.local`, and leave system directories untouched. Production code must not log credentials, complete environment objects, raw continuation records, or router authorization data.

Documentation and DS prose must remain unwrapped in source. The repository-level size checker must include `codexAgent/docs`.
