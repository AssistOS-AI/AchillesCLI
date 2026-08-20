---
title: DS001-coding-style
summary: Defines PI Agent's ES-module conventions, sandbox code boundaries, event parsing, persistence, and tests.
---

## Introduction

PI Agent contains Node.js task wrappers, a shared Bubblewrap builder, PI event parsing, model-state resolution, a scoped Soul broker, authentication controls, and lifecycle scripts. Changes must keep security-sensitive path and environment logic separate from provider presentation.

## Core Content

JavaScript files must use ES modules, four-space indentation, and explicit dependency injection for sandbox probes and process spawning used by tests. Task entry points must parse one JSON input, return one structured JSON result, and send live provider text or diagnostics to standard error according to the AgentServer task-log contract.

| Concern | Contract |
| --- | --- |
| Sandbox preparation | Canonical path checks, capability probes, environment filtering, and Bubblewrap argument construction must remain separate testable operations. |
| PI events | JSONL parsing must be incremental, byte bounded, and responsible for removing duplicate cumulative tool updates. |
| Persistence | Continuation and login stores must use UUID handles, restrictive modes, atomic writes, and symlink rejection. |
| Cancellation | Wrappers must handle `SIGTERM`, terminate PI, and preserve an allocated session handle when the task reached provider execution. |
| Tests | Sandbox failure, event filtering, output bounds, installation, continuation, cancellation, model precedence, and generated-local routing belong under `test/*.test.mjs`. |

Production environment construction must use an allowlist and must not forward raw Ploinky authority or provider secret variables into the nested task. The installer must place PI under the persistent agent home and must not require writes to `/usr/local`.

Documentation and specification prose must remain unwrapped in source. The repository size checker must include `piAgent/docs`.
