---
title: DS001-coding-style
summary: Defines OpenCode Agent's module boundaries, secure process rules, provider adapters, persistence, and tests.
---

## Introduction

OpenCode Agent contains ES-module task wrappers, a provider runner, a nested Bubblewrap builder, session and login stores, OpenAI-compatible endpoint adapters, a scoped Soul broker, and install/readiness scripts. Changes must keep these responsibilities independently testable.

## Core Content

JavaScript must use ES modules, four-space indentation, explicit imports, and deterministic helpers for prompt conversion, model parsing, session discovery, sandbox construction, and authentication transitions. Entry points must accept one JSON request and return one structured response, while native provider output and diagnostics follow the AgentServer log stream.

| Concern | Contract |
| --- | --- |
| Sandbox code | Path validation, capability probing, mount selection, environment filtering, and process spawning must remain separate operations with injected test dependencies. |
| Session discovery | Native formatted output must stay independent from session-list, database fallback, and export parsing. |
| Persistence | Continuation and login records must use restrictive modes, UUID identifiers, atomic replacement, and symlink rejection. |
| Provider adapters | Chat-completions and models handlers must reuse shared runner or parser behavior instead of creating divergent execution policy. |
| Tests | Installation, configuration, model mapping, OpenAI message conversion, sandbox failure, execution, continuation, cancellation, and authentication belong under `test/*.test.mjs`. |

The installer must validate and atomically install the repository-owned `opencode.json` without replacing provider authentication, sessions, or recent-model state. Production logs must not expose session-list output, exported message JSON, internal lookup titles, credentials, or continuation records.

Documentation and specification prose must remain unwrapped in source. The repository size checker must include `opencodeAgent/docs`.
