---
id: DS004
title: Entrypoint and Runtime Bootstrap
status: active
owner: AchillesCLI Maintainers
summary: Specifies CLI startup, dependency loading, argument parsing, and runtime-mode selection.
---

# DS004-entrypoint-runtime-bootstrap

## Introduction
This DS documents the executable bootstrap contract implemented in `achilles-cli/src/index.mjs`.

## Core Content
Startup responsibilities:
1. Resolve core dependencies, including AchillesAgentLib access strategy.
2. Parse command-line arguments and select execution mode.
3. Construct the `MainAgent` with configured roots and runtime options.
4. Start one of the supported interaction modes: single-shot, REPL, or webchat session loop.

Argument and mode contract:
1. Non-interactive prompt inputs execute directly and return output.
2. Interactive mode starts `REPLSession` and command loop services.
3. Webchat mode initializes `LoopAgentSession` with IO handlers.

Dependency bootstrap contract:
1. Respect manual path overrides for AchillesAgentLib when provided.
2. Support fallback search paths (workspace-relative and `node_modules`).
3. Emit explicit startup errors when required runtime pieces are unavailable.

Runtime wiring:
1. Construct or rehydrate `LLMAgent`/`MainAgent` with runtime configuration.
2. Attach command execution utilities and UI providers.
3. Register built-in and discovered skill roots before accepting requests.
4. In webchat mode, run the startup intro unless `PLOINKY_WEBCHAT_HAS_HISTORY=1`; no folder session identifier is required by the agent process.

Configuration boundaries:
1. Startup must not hardcode environment-specific absolute paths.
2. Startup config must preserve override + fallback semantics.
3. Runtime metadata tags remain available for routing-sensitive tasks.

## Conclusion
Entrypoint bootstrap is the operational root of AchillesCLI and must remain deterministic, debuggable, and override-friendly across local and integrated environments.
