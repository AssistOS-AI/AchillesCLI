---
id: DS004
title: Entrypoint and Runtime Bootstrap
status: active
owner: AchillesCLI Maintainers
summary: Specifies CLI startup, dependency loading, argument parsing, and runtime-mode selection.
---

# DS004-entrypoint-runtime-bootstrap

## Introduction
This DS documents the executable bootstrap contract implemented by `achilles-cli/src/cli.mjs`, the external broker, and the sandboxed `achilles-cli/src/index.mjs` runtime.

## Core Content
Startup responsibilities:
1. `src/cli.mjs` resolves the real workspace, starts the trusted broker, and launches `src/index.mjs` in Bubblewrap.
2. Resolve core dependencies, including AchillesAgentLib access strategy, as read-only runtime mounts.
3. Parse command-line arguments and select execution mode.
4. Construct the `MainAgent` with configured roots, the Bash-only Supervisor proxy, and a local Bash executor that inherits the persistent sandbox.
5. Start one of the supported interaction modes: single-shot, REPL, or webchat session loop.

Argument and mode contract:
1. Non-interactive prompt inputs execute directly and return output.
2. Interactive mode starts `REPLSession` and command loop services.
3. Webchat mode initializes `LoopAgentSession` with IO handlers.
4. `/permissions` and `--permissions` accept only `ask-for-approval` and `full-access`.
5. The trusted entrypoint restores the permission mode from `<workspace>/.achilles-cli/settings.json`; a valid explicit `--permissions` value overrides the persisted value for that process, while a missing or invalid setting falls back to `ask-for-approval`.

Dependency bootstrap contract:
1. Respect manual path overrides for AchillesAgentLib when provided.
2. Support fallback search paths (workspace-relative and `node_modules`).
3. Emit explicit startup errors when required runtime pieces are unavailable.

Runtime wiring:
1. Construct or rehydrate `LLMAgent`/`MainAgent` with runtime configuration.
2. Attach command execution utilities and UI providers.
3. Register built-in and discovered skill roots before accepting requests.
4. Before single-shot execution or either interactive loop starts, load or create the current AchillesCLI conversation from `<workspace>/.achilles-cli/sessions/`. The selected id is the `currentSessionId` key in `.achilles-cli/settings.json`, beside model and permissions.
5. Run the startup intro only when the current AchillesCLI conversation has no messages. In single-shot, REPL, and WebChat modes, pass stored user/assistant turns once as `initialHistory` on the first natural-language prompt after process startup or session selection; slash commands must not consume this pending hydration.
6. In webchat mode, publish the explicit model restored from
   `.achilles-cli/settings.json` before accepting user input and publish `null`
   when that setting is absent. Runtime-state envelopes do not carry a
   process-instance identifier. Publish the current conversation through a
   `__webchatSession` envelope after startup, session selection, and completed
   turns. Also publish a version-1 `__webchatWorkspaceFiles` full snapshot for
   the active working directory at startup, refresh it every five seconds, and
   refresh it immediately before assistant or command output. Later
   publications must be added/removed deltas and must be omitted when the
   indexed file set did not change. These control records are WebChat metadata
   and must not alter ordinary terminal output or conversation history.
7. The broker remains outside Bubblewrap and handles authorization only. MainAgent, skill code, the local Bash executor, and every Bash child process inherit the persistent workspace sandbox.
8. Bubblewrap keeps the network namespace shared and exposes only system runtime paths, read-only Achilles code/dependencies, isolated temporary storage, the broker socket, and the writable session workspace.
9. Startup fails closed when Bubblewrap or the broker connection is unavailable. Before
   starting Bubblewrap, the trusted entrypoint must also verify that `/proc/self`
   identifies its own process id and that its own PID namespace handle is visible.
   A proc filesystem inherited from a parent PID namespace is a startup error.
10. The Unix socket protocol must preserve its response half after the client finishes writing a request, because broker handlers may complete asynchronously.
11. In webchat mode, structured interaction responses received on stdin must be demultiplexed before ordinary prompt processing and forwarded through the trusted broker control channel.
12. A successful `/permissions` change must update the trusted Broker before the confirmed mode is written atomically to the workspace settings file.
13. A restoring turn with non-empty `initialHistory` must bypass prompt-only cached provider results so the restored context reaches the planner that produces the current answer.

Configuration boundaries:
1. Startup must not hardcode environment-specific absolute paths.
2. Startup config must preserve override + fallback semantics.
3. Runtime metadata tags remain available for routing-sensitive tasks.

## Decisions & Questions

### Question #1: Why does startup publish the model through stdout instead of exposing the settings path to WebChat?

Response:
The working-directory settings file is owned by AchillesCLI and is not part of Ploinky's generic browser contract. Publishing a bounded runtime-state envelope keeps filesystem access and model semantics inside the agent while allowing compatible clients to present the current explicit selection.

### Question #2: Why is the network namespace shared while the filesystem is confined?

Response:
MainAgent must reach configured LLM services and router-mediated agents during normal operation. The implemented security boundary addresses workspace filesystem confinement; network policy remains an independent runtime concern and is not broadened by a Bash approval.

### Question #3: Why can a nested container use an empty `/proc`?

Response:
Bubblewrap must probe whether the current runtime permits mounting a private proc filesystem. Native host execution uses a private `/proc` when supported. A nested unprivileged container that rejects the proc mount must receive an empty `/proc` directory instead; it must never bind the outer container's `/proc`, because that would expose process-root paths across the filesystem boundary. The agent container's pre-sandbox `/proc` must itself represent the agent PID namespace, because Bubblewrap resolves its namespace child through that proc filesystem before it constructs the sandbox root.

### Question #4: Why does AchillesCLI restore sessions instead of relying on WebChat process identity?

Response:
AchillesCLI can run with no browser at all, so a WebChat runtime or PID cannot be the durable conversation owner. Loading `currentSessionId` and its session file during every process startup gives single-shot, terminal, and browser launches the same behavior and lets AchillesCLI hydrate a freshly created MainAgent exactly once.

## Conclusion
Entrypoint bootstrap is the operational root of AchillesCLI and must remain deterministic, debuggable, and override-friendly across local and integrated environments.
