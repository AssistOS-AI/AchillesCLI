---
title: DS004-entrypoint-runtime-bootstrap
summary: Specifies CLI startup, dependency loading, argument parsing, and runtime-mode selection.
---

## Introduction
This DS documents the executable bootstrap contract implemented by `achilles-cli/src/cli.mjs`, the external broker, and the sandboxed `achilles-cli/src/index.mjs` runtime.

## Core Content
The standalone package under `achilles-cli/` must declare AchillesAgentLib as a Node dependency and must expose `npm start` as the local entry path to `src/cli.mjs`. A local checkout with Node.js 20 or newer, npm, Git, and Bubblewrap may therefore prepare JavaScript dependencies with `npm install` without requiring Ploinky's dependency cache. Soul Gateway configuration remains a separate runtime requirement.

Startup responsibilities:
`src/cli.mjs` resolves the real workspace, starts the trusted broker, and launches `src/index.mjs` in Bubblewrap.

Resolve core dependencies, including AchillesAgentLib access strategy, as read-only runtime mounts.

Parse command-line arguments and select execution mode.

Construct the `MainAgent` with configured roots, the Bash-only Supervisor proxy, and a local Bash executor that inherits the persistent sandbox.

Start one of the supported interaction modes: single-shot, REPL, or webchat session loop.

Argument and mode contract:
Non-interactive prompt inputs execute directly and return output.

Interactive mode starts `REPLSession` and command loop services.

Webchat mode initializes `LoopAgentSession` with IO handlers.

`/permissions` and `--permissions` accept only `ask-for-approval` and `full-access`.

The trusted entrypoint restores the permission mode from `<workspace>/.achilles-cli/settings.json`; a valid explicit `--permissions` value overrides the persisted value for that process, while a missing or invalid setting falls back to `ask-for-approval`.

Dependency bootstrap contract:
Respect manual path overrides for AchillesAgentLib when provided.

Support fallback search paths (workspace-relative and `node_modules`).

Emit explicit startup errors when required runtime pieces are unavailable.

Runtime wiring:
Construct or rehydrate `LLMAgent`/`MainAgent` with runtime configuration.

Attach command execution utilities and UI providers.

Register built-in and discovered skill roots before accepting requests.

Before single-shot execution or either interactive loop starts, load or create the current AchillesCLI conversation from `<workspace>/.achilles-cli/sessions/`. The selected id is the `currentSessionId` key in `.achilles-cli/settings.json`, beside model and permissions.

Run the startup intro only when the current AchillesCLI conversation has no messages. In single-shot, REPL, and WebChat modes, pass stored user/assistant turns once as `initialHistory` on the first natural-language prompt after process startup or session selection; slash commands must not consume this pending hydration.

In webchat mode, publish the explicit model restored from `.achilles-cli/settings.json` before accepting user input and publish `null` when that setting is absent. Runtime-state envelopes do not carry a process-instance identifier. Publish the current conversation through a `__webchatSession` envelope after startup, session selection, and completed turns. Also publish a version-1 `__webchatWorkspaceFiles` full snapshot for the active working directory at startup, refresh it every five seconds, and refresh it immediately before assistant or command output. Later publications must be added/removed deltas and must be omitted when the indexed file set did not change. These control records are WebChat metadata and must not alter ordinary terminal output or conversation history.

The broker remains outside Bubblewrap and handles authorization only. MainAgent, skill code, the local Bash executor, and every Bash child process inherit the persistent workspace sandbox.

Bubblewrap keeps the network namespace shared and exposes only system runtime paths, read-only Achilles code/dependencies, isolated temporary storage, the broker socket, and the writable session workspace.

Startup fails closed when Bubblewrap or the broker connection is unavailable. Before starting Bubblewrap, the trusted entrypoint must also verify that `/proc/self` identifies its own process id and that its own PID namespace handle is visible. A proc filesystem inherited from a parent PID namespace is a startup error. Optional OpenCode and PI task workers apply the same outer-proc identity prerequisite before their own nested-Bubblewrap probe or any project/session mutation. They probe a private proc mount first. When the container runtime rejects that mount, they may use the existing proc filesystem read-only only after a guard running inside the same user and PID namespaces proves that `/proc/self/maps` describes the sandbox command and that the parent worker's environment, root, working directory, and file descriptors remain inaccessible. Task input and environment cannot choose or loosen that trusted selection, and a failed guard is a capability failure.

The Unix socket protocol must preserve its response half after the client finishes writing a request, because broker handlers may complete asynchronously.

In webchat mode, structured interaction responses received on stdin must be demultiplexed before ordinary prompt processing and forwarded through the trusted broker control channel.

A successful `/permissions` change must update the trusted Broker before the confirmed mode is written atomically to the workspace settings file.

A restoring turn with non-empty `initialHistory` must bypass prompt-only cached provider results so the restored context reaches the planner that produces the current answer.

Configuration boundaries:
Startup must not hardcode environment-specific absolute paths.

Startup config must preserve override + fallback semantics.

Runtime metadata tags remain available for routing-sensitive tasks.

### Rationale and Boundaries

The working-directory settings file is owned by AchillesCLI and is not part of Ploinky's generic browser contract. Publishing a bounded runtime-state envelope keeps filesystem access and model semantics inside the agent while allowing compatible clients to present the current explicit selection.

MainAgent must reach configured LLM services and router-mediated agents during normal operation. The implemented security boundary addresses workspace filesystem confinement; network policy remains an independent runtime concern and is not broadened by a Bash approval.

Bubblewrap first probes whether the runtime permits mounting a private proc filesystem. Native host execution uses that mode when supported. Bun-based task providers such as OpenCode require a live `/proc`, so an empty directory is not a viable fallback in a nested unprivileged container. The worker may instead bind its existing proc filesystem read-only while retaining Bubblewrap's user and PID namespace isolation. A guard executed through that exact sandbox path must prove that `/proc/self` is dynamic for the sandbox command and that proc magic links and process data cannot cross back into the parent worker; otherwise startup fails closed. The agent container's pre-sandbox `/proc` must itself represent the agent PID namespace, because Bubblewrap resolves its namespace child through that proc filesystem before it constructs the sandbox root.

A generated-local launch gives the outer agent container a signed Router descriptor at the fixed `/run/ploinky/router-descriptor.json` path. MainAgent needs that descriptor to validate its Router authority, but Bubblewrap starts from an empty filesystem. The Broker may therefore add exactly that file as a read-only mount only when the locator has generated provenance and the fixed path is a bounded `0600` regular non-symlink owned by the current numeric user and group. It must reject arbitrary descriptor paths, explicit provenance, ownership changes, and real-path replacement before creating MainAgent's sandbox. No other `/run` state becomes visible.

AchillesCLI can run with no browser at all, so a WebChat runtime or PID cannot be the durable conversation owner. Loading `currentSessionId` and its session file during every process startup gives single-shot, terminal, and browser launches the same behavior and lets AchillesCLI hydrate a freshly created MainAgent exactly once.
