---
id: DS010
title: Ecosystem Integration (Ploinky, AchillesAgentLib, AchillesIDE)
status: active
owner: AchillesCLI Maintainers
summary: Defines integration boundaries and contracts between AchillesCLI and the surrounding ecosystem repositories.
---

# DS010-ecosystem-integration

## Introduction
This DS defines the required integration boundaries for AchillesCLI across the local ecosystem repositories used in development and runtime workflows.

## Core Content
Integration scope:
1. AchillesCLI is a runnable CLI/runtime repository.
2. AchillesAgentLib provides the core agent runtime primitives consumed by AchillesCLI.
3. Ploinky provides workspace/runtime orchestration where AchillesCLI can be enabled and executed.
4. AchillesIDE provides a related multi-agent workspace/IDE surface whose contracts shape interoperability expectations.

Portable integration references (any environment):
1. Ploinky repository: `<workspace-root>/ploinky`
2. AchillesAgentLib installation path: `<ploinky-root>/node_modules/achillesAgentLib` (or equivalent dependency root resolved by runtime config)
3. AchillesIDE repository: `<workspace-root>/.ploinky/repos/AchillesIDE`

AchillesAgentLib contract:
1. AchillesCLI imports and uses `MainAgent`, `LLMAgent`, and related runtime helpers.
2. AchillesCLI delegates skill discovery/orchestration semantics to AchillesAgentLib.
3. AchillesCLI must preserve compatibility with AchillesAgentLib skill subsystem expectations.
4. When AchillesCLI uses Agentic Knowledge Units, AchillesAgentLib DS008 remains the AKU library authority. AchillesCLI-specific Copilot memory behavior is governed by DS011 and must not be pushed into the AKU library contract.
5. AchillesCLI supplies a decorated `invokerStrategy` through `MainAgent.llmAgentOptions`. The decorator must force the `soul_gateway` provider key, preserve opaque model identifiers, delegate the standard invoker implementation, and retain its auxiliary introspection methods. AchillesAgentLib remains responsible for provider-adapter execution, while Soul Gateway remains responsible for model validation and routing.

Ploinky integration boundary:
1. AchillesCLI should remain compatible with workspace-managed runtime contexts.
2. Startup assumptions must avoid hardcoded machine-specific paths in core runtime logic.
3. Session/webchat runtime paths should keep durable-state assumptions aligned with orchestrated process lifecycles.
4. The Ploinky agent manifest should use the shared `docker.io/assistos/ploinky-node:24-bookworm-tools` image so Explorer cold starts reuse the same Node 24 glibc runtime and preinstalled dependency-cache tools as the rest of the default agent graph.
5. The Ploinky agent manifest temporarily declares `SOUL_GATEWAY_API_KEY` as a `sharedGeneratedSecret` with `explicitOverride: true` so Explorer-launched AchillesCLI can honor a hosted Soul Gateway key from parent `.env` files. This is not canonical AchillesCLI integration behavior and must be removed when the local deployed Soul Gateway is the only supported provider path.
6. AchillesCLI exposes its skill catalog as MCP tools via the AgentServer mechanism. Each user skill is exposed as `execute_<sanitised_skill_name>` with an input schema derived from the skill's argument expectations. WebChat clients query this catalog at session start to populate slash-command autocomplete menus. AchillesCLI also owns the public `list_achilles_skills` catalog tool used by Explorer settings; the tool defaults discovery to the runtime `WORKSPACE_PATH`, and Explorer must not import AchillesAgentLib discovery code or know AchillesCLI's dependency layout. AchillesCLI slash commands are provided through the separate `list_achilles_cli_commands` MCP catalog tool, which returns a structured command/sub-command payload and does not execute chat prompts. That command tool accepts an optional `dir` argument and uses `achillesAgentLib` skill discovery from that directory to publish argument completions for slash commands that operate on skills. When a discovered skill descriptor contains `## Help`, the catalog publishes that text as the argument completion description for the skill. The catalog must also publish `ask-for-approval` and `full-access` as the supported `/permissions` argument completions. The same server-side command-catalog call queries the local Soul Gateway with the generated agent identity and publishes minimal model completions for `/model`; credentials and raw provider configuration never enter the browser payload. The command declares generic fragment matching and leaves the full filtered result set available to Ploinky's progressively rendered menu, so Ploinky does not hardcode AchillesCLI command names.
7. The webchat interactive mode (`runWebchatInteractive`) accepts ESC (`\x1b`) as a standalone input line to cancel the current prompt execution. This enables remote cancel from browser-based WebChat sessions.
8. The webchat interactive mode must treat `@open-interpreter` and other
   `@agent`-shaped tokens as ordinary chat text. Provider dispatch is semantic
   and launcher-driven; Ploinky WebChat remains only the envelope and
   invocation-token transport.
9. Generic WebChat envelope and resource helpers live in AchillesCLI. These
   helpers normalize envelope text, extract the
   invocation token, and materialize browser attachments or workspace
   references from legacy shared blob ids under the configured shared root or
   safe cwd-relative files uploaded directly below the active WebChat working
   directory. Direct paths must stay inside the working directory after
   realpath resolution, reject traversal, `.secrets`/`*.secrets`, metadata
   internals, and symlink escapes, and preserve the same byte caps as other
   forwarded resources. Files above the inline byte limit must remain available
   to launcher integrations through their validated path rather than being
   discarded.
10. Non-slash WebChat turns normally use AchillesCLI's general skill-aware
   reasoning loop. Before that loop, a deterministic named-coding-agent
   selector handles explicit task requests for `opencode`/`opencodeAgent`,
   `codex`/`codexAgent`, and `piAgent`. It must select `launch-opencode`,
   `launch-codex`, or `launch-pi`, respectively, so named-provider intent is
   not lost to generic reasoning or another execution launcher. Mere mentions
   without task intent remain ordinary chat. Launchers receive the
   normalized prompt, safe WebChat context, and current invocation token through
   the AchillesCLI skill execution context. Launchers must call external
   provider execution only through
   `copilotProviderRelay.copilot_provider_task_submit` via router-mediated MCP.
   Provider-specific launchers may perform a bounded
   provider-owned status probe through router-mediated MCP before submitting the
   task so unavailable provider routes fail with an explicit user-facing
   message instead of a later relay submission error. Directory and other
   non-file workspace references may be represented in Copilot prompt context,
   but launchers must forward only file path strings in relay `paths` payloads.
11. The Explorer Copilot launcher may consume runtime plugin metadata from
   `file-exp:copilot-launch-extension` to add generic WebChat launch query
   parameters such as `forward-envelope=1` and `workspace-dir`. It must not add
   provider backend ids, provider agent ids, or provider MCP tool names to the
   WebChat URL; the visible Explorer action remains the
   normal `Open Copilot here` action.
12. Repository maintenance through `/update repos` runs inside the active AchillesCLI runtime context and updates repositories already cloned under `.data/achilles-cli/repos/`; hosts must surface aggregated per-repository git pull failures unchanged.
13. In webchat runtime mode, AchillesCLI installs a supervisor that auto-approves loop-session tool calls and emits structured progress lines on stdout. Progress lines use `{"__webchatProgress":1,"type":"tool_reason","tool":"...","reason":"..."}` and must be treated as UI progress metadata, not as assistant answer text.
14. In webchat runtime mode, AchillesCLI preserves the sanitized
    `origin.publicBaseUrl` field from forwarded WebChat envelopes in launcher
    context. Launcher skills may use this same-origin router base for
    user-facing browser links, while ignoring malformed or non-HTTP origin
    hints.
15. AchillesCLI owns conversation sessions for both terminal and WebChat launches.
    It stores them under `<workspace>/.data/achilles-cli/sessions/`, stores the selected
    `currentSessionId` beside model and permissions in `.data/achilles-cli/settings.json`,
    and supplies prior natural-language turns once as `initialHistory` on the
    first normal prompt after startup or session selection. Incoming WebChat
    envelopes cannot supply history. Slash commands do not consume pending
    hydration. A sanitized `presentation.visible` flag distinguishes composer
    commands from silent WebChat control actions. Visible slash commands, their
    visible responses, and any task-reference items they create are stored in
    the durable session for transcript restoration, with command records marked
    `context: false` so neither they nor task items enter MainAgent history.
    Invisible UI control commands create no session records.
    AchillesCLI publishes version-1 `__webchatSession` envelopes for the current
    snapshot, session lists, and selected sessions. WebChat requests those changes
    through `/session`, `/session new`, and `/session resume <session-id>`.
    `__webchatRuntimeState` continues to publish model state but carries no
    process-instance identifier.
16. In single-shot, terminal REPL, and WebChat runtime modes, AchillesCLI
    registers a generic asynchronous-task observer with Ploinky
    `AgentMcpClient.mjs`. Launcher skills that delegate
    long-running work use `callToolWithoutWait`, so an AgentServer response
    carrying `taskId` metadata is offered to that observer instead of entering
    client-owned blocking polling. AchillesCLI must identify such work by target
    agent plus remote task id, persist lifecycle metadata and logs under
    `<workspace>/.data/achilles-cli/tasks/`, and continue polling through the
    router-mediated task-status path. A recreated AchillesCLI process must
    reattach tasks recorded as ongoing. WebChat mode additionally emits
    `__webchatTask` list, view, lifecycle, log, and action envelopes for the
    generic browser interface. The observer must not persist agent credentials,
    invocation grants, or raw tool arguments.
17. AchillesCLI exposes `/tasks [count|all]` through its shared slash-command
    catalog and handler, plus `/task view <task-id>`, `/task stop <task-id>`,
    and `/task continue <task-id> <prompt>`. Both WebChat and terminal REPL
    modes use the same AchillesCLI-owned manager and journal. The command
    catalog attaches action-compatible task completions to the `/task`
    subcommands, displaying task names while inserting local task ids. WebChat
    buttons send those commands instead of invoking task data or action REST
    routes. Those button-originated commands are invisible control traffic, so
    AchillesCLI must emit their structured task envelopes but suppress their
    textual acknowledgements and errors from the main WebChat transcript.
18. The AchillesCLI manifest enables `proxies/soul-gateway` as a no-wait
    dependency. Soul Gateway owns a custom port-7000 HTTP process, so the
    confined-relay runtime does not synthesize an AgentServer primary
    readiness target for it. Model discovery must treat a still-starting
    gateway as temporarily unavailable and retry on a later catalog request;
    it must not block the entire Explorer graph on a nonexistent
    primary-service probe. Model listing uses the router-mediated
    `/base-agent-additional-server/soul-gateway/7000/v1/models` route and the
    existing generated Ploinky agent credential; it does not add a public HTTP
    service, delegation, or MCP execution tool.
    The same manifest enables the exact `roboTeamAgent no-wait` dependency so
    its authenticated profile dashboard starts asynchronously without delaying
    AchillesCLI's own activation.
19. Optional coding and research workers are intentionally absent from the AchillesCLI manifest `enable` list and declare `startup: manual`. `opencodeAgent`, `piAgent`, `codexAgent`, `GPTResearcher`, and `proxies/searchAgent` therefore do not join the recursive Explorer startup graph merely because AchillesCLI is active or because they remain enabled from an earlier session. Provider launchers that invoke an MCP worker must query Marketplace runtime state through `AgentMcpClient`, submit the existing `enable_agent` action in explicit `global` mode only when the worker is not running, wait for readiness, and then make the router-mediated MCP call. `launch-gpt-researcher` starts `proxies/searchAgent` before `AchillesCLI/GPTResearcher`. Direct operator invocation through `ploinky cli codexAgent` remains available alongside the `launch-codex` MCP delegation path.
    Optional activation is additive: the candidate must be admitted and become
    ready before routing selection changes, and a failed candidate must leave
    the active generation plus unrelated Router and Soul Gateway routes
    continuously available. A launcher surfaces the allowlisted safe lifecycle
    code returned by that transaction without exposing its command line,
    environment, credentials, or hidden routing state.
20. The AchillesCLI background-task observer must persist and forward the target task's live log snapshot and lifecycle metadata. On a terminal event it may also use the textual MCP result as separate presentation metadata, never as appended log content. AchillesCLI uses that text only to locate the already emitted final-answer range in its persisted raw log and stores a bounded ordered `finalOutputRanges` entry for each retained completed turn instead of duplicating the text. Continuation preserves all earlier retained entries. Materialization must reconstruct the range list from legacy append-only journal records that contain only `finalOutputOffset` and `finalOutputLength`, so existing task logs require no rewrite. WebChat can then render intermediate output and every retained final answer distinctly.
21. Async `opencodeAgent`, `piAgent`, and `codexAgent` executions must publish a generic
    continuation capability and an opaque versioned handle once their provider
    session exists, including when a later provider error makes the task fail.
    AchillesCLI forwards this capability and handle in its generic task
    envelopes without interpreting provider session ids or storage paths.
    AchillesCLI owns the stable local task id and turn progression; a
    continuation creates a new remote AgentServer task but remains the same
    workspace task. It must retain final-output ranges from all completed turns
    while the next turn is active. Before forwarding provider output,
    AchillesCLI appends the submitted continuation prompt to the same durable
    task log as `you> <prompt>` without a synthetic continuation-turn label and
    emits the exact appended text plus the resulting offset for an already open
    task view.
    The provider agents expose a separate internal
    `continue-task` MCP tool that accepts only the opaque handle and new prompt,
    restores the original project directory and provider session from
    agent-private persistent storage, and returns the same handle. AchillesCLI
    invokes that tool as the verified source agent in both terminal and WebChat
    modes; the browser never invokes it directly. Initial and continued
    executions opt into full task-log retention. Their `execute-task` and
    `continue-task` MCP definitions and provider runners must not impose an
    elapsed-time limit: coding work remains active until the provider exits,
    the user cancels it, execution fails, or the runtime is interrupted.
22. Async `opencodeAgent`, `piAgent`, and `codexAgent` wrappers must treat
    `SIGTERM` as a controlled cancellation request. Each wrapper aborts its
    provider subprocess, waits for the runner to resolve the provider session
    or thread when one already exists, persists the opaque continuation record,
    emits the same structured continuation descriptor, and exits
    unsuccessfully so AgentServer records `cancelled` rather than success.
    AgentServer may force-terminate the process group after its two-second
    cleanup grace period. Cancellation before provider execution creates no
    handle; cancellation after session creation remains continuable through the
    normal stable-local-task-id flow.
23. `/task stop` must call the stored target through
    `AgentMcpClient.cancelTask()` using an Agent Assertion bound to
    `POST /task/cancel`, pseudo-tool `__task_cancel__`, and the exact stored
    remote task id. The router verifies that assertion and replaces it with a
    target-scoped Router Request. AchillesCLI must not receive or forward a
    browser session token for this action.
24. In WebChat mode, AchillesCLI owns the recursive index of regular files in
    its active working directory. It must publish a bounded version-1
    `__webchatWorkspaceFiles` reset snapshot at startup, rescan every five
    seconds, and rescan immediately before emitting assistant or command output.
    It must publish added/removed deltas only when the set changes. The scan must
    reject symlinks, reserved secret names, AchillesCLI/Ploinky runtime state,
    dependency trees, and VCS internals. Index envelopes are transport metadata:
    they must remain outside terminal presentation and durable conversation
    history, and they must not replace Ploinky's authenticated read-time path
    validation.

AchillesIDE interoperability boundary:
1. AchillesIDE documents a broader agent ecosystem with MCP and workspace routing expectations.
2. AchillesCLI documentation must remain explicit about what is native to CLI vs what belongs to IDE/router hosts.
3. Shared conventions (safe user output, debug gating, deterministic command behavior) must remain compatible across ecosystem tools.
4. AchillesCLI may ship IDE menu plugins through `achilles-cli/IDE-plugins/` for workspace skill-management affordances. The `edit-skills-manifest` plugin contributes only to Explorer folder context menus, uses Explorer's existing file read/write tools, and persists `ploinky-skills-manifest.json` as a JSON array of skill repository URLs in the selected folder. It must not add new router routes, MCP tools, or privileged policy surfaces.
5. The AchillesCLI Copilot IDE integration must expose one logical application plugin through two contributions with the shared id `achilles-cli-copilot`. The mount contribution appears in `file-exp:toolbar-plugins-dropdown` as `Open Copilot here` and launches against the displayed directory using Explorer's `currentFsPath` and `workspaceFsRoot` context. The menu contribution preserves the same action for selected directory rows under `file-exp:context-menu:directory`. Explorer `/` maps to the workspace root; neither contribution may navigate above that boundary or require a synthetic parent entry.

Cross-repository invariants:
1. No repository should assume hidden runtime side effects from another without documented contracts.
2. Integration docs must describe boundaries and responsibilities, not duplicate entire external specs.
3. When AchillesAgentLib or host-runtime integration points change, AchillesCLI DS files must be updated in the same change set.

Provider launcher discovery:
1. Built-in provider launcher skills under `achilles-cli/src/skills/` may
   provide fallback behavior, but they do not define provider availability.
2. In Ploinky workspaces, AchillesCLI discovers provider launcher skills
   generically from workspace-managed repository clones under
   `.ploinky/repos/<repo>/achilles-skills`. Discovery must not hardcode
   `copilot-agents`, backend names, provider agent ids, or provider MCP tool
   names.
3. A deployed repo launcher with the same normalized skill name may replace a
   built-in fallback during startup registration. This makes the invariant
   explicit: an external provider becomes selectable by exposing a launcher
   skill, not by a Ploinky enable-research command or WebChat tag toggle.
4. A launcher that requires delegated MCP must declare that requirement in its
   descriptor and return a clear user-facing unavailable message when the
   invocation token or relay route is absent.
5. Provider availability for Copilot routing is determined by discovered
   launcher skills, not by a Ploinky research enable command, bundle command, or
   WebChat toggle. A launcher may report that its relay backend or provider
   route is unavailable, but it must not tell the user to run an enable-research
   command to make the provider selectable.
6. `launch-opencode`, `launch-pi`, and `launch-codex` are bounded exceptions
   for direct named-agent delegation. Each starts its fixed installed target through the
   existing Marketplace enable path in explicit `global` mode only when
   runtime status is not already running, then calls that agent's allowlisted
   `execute-task` MCP tool through the router. All three accept only the plain
   task text, pass that text unchanged as `prompt`, and never inherit or forward
   the AchillesCLI session model. They return plain text and must not accept
   arbitrary target agent names or bypass Ploinky MCP authorization.
7. The AchillesCLI Ploinky manifest must not enable `opencodeAgent`, `piAgent`,
   `codexAgent`, `GPTResearcher`, or `proxies/searchAgent`. These optional
   workers are activation-time dependencies of their launcher or direct CLI
   invocation, not startup-time dependencies of AchillesCLI. Their own
   manifests must declare `startup: manual` so a later general workspace boot
   does not revive a dormant worker merely because it remains registered.
8. `piAgent` must run PI in JSON event-stream mode with an explicit persisted
   session id and session directory. The wrapper must parse PI's JSONL stdout
   incrementally and immediately forward assistant text deltas and textual tool
   output to the AgentServer live-log channel. Cumulative tool updates and their
   final result must be de-duplicated. Assistant `message_end` text is the final
   `outputText`; lifecycle events, thinking content, signatures, encrypted
   content, and usage metadata must not enter the visible log. Non-JSON
   diagnostic stdout and provider stderr remain visible without synthetic
   status messages or stream prefixes. Its task runner must
   retain `HOME=/root` and must not
   override `PI_CODING_AGENT_DIR`, so interactive CLI login, initial tasks, and
   continued tasks all use PI's persistent default configuration directory
   under the agent home, including the same OAuth credentials and settings.
   The PI profile installer must install the package and stable launcher under
   `$HOME/.local`, and the manifest and task runner must resolve that
   home-relative launcher. It must not require writes to `/usr/local`, because
   host-sandbox runtimes expose system files read-only while keeping the agent
   home writable and persistent. The installer must invoke npm through an
   absolute CLI path selected for the container or mounted Bubblewrap Node
   runtime, while an explicit `NPM_CLI` remains a test and operator override.
   The PI MCP task commands must invoke `node` through `PATH` so the same
   configuration resolves the image-provided Node binary in containers and
   Ploinky's mounted Node distribution in Bubblewrap.
   `opencodeAgent` must run tasks in OpenCode's default
   formatted-output mode with `--auto`, must not use
   `--dangerously-skip-permissions`, and must pass the captured provider session
   id through `--session` on continuation. OpenCode must relay provider stdout
   and stderr byte-for-byte to the AgentServer live-log channel without
   synthetic status messages or stream prefixes. Its profile install hook must
   install the current OpenCode release and then atomically replace the
   OpenCode config under the effective runtime `HOME` with the repository-owned
   Soul Gateway provider template before AgentServer starts. The template must
   reference only a task-scoped loopback broker URL and short-lived broker key
   through OpenCode environment substitution, must add the `fast`, `deep`, and `plan`
   models, must set the permission catch-all to `allow`, must override
   `external_directory` to `deny`, and must not select a default model or
   restrict other providers. This is an OpenCode application policy rather
   than an operating-system filesystem sandbox by itself.
   Both `opencodeAgent` and `piAgent` must additionally start every initial
   and continued provider process inside a task-local Bubblewrap namespace.
   The wrapper must canonicalize `projectDir`, require it to remain under
   `PLOINKY_WORKSPACE_ROOT`, expose system/runtime files read-only, make the
   namespace root read-only, and bind only the canonical `projectDir` writable
   from the workspace. Provider-owned configuration and session directories
   may be mounted separately with the minimum required access; the broader
   workspace root and sibling projects must not be mounted. The task sandbox
   shares the existing network namespace so provider API routing continues to
   work, but unshares user, PID, IPC, and UTS namespaces. Before probing or
   mutating project/session state, it must verify that outer `/proc/self`
   represents the worker's current PID namespace and probe private proc first.
   After a private-mode failure, it may bind the existing proc filesystem
   read-only only when an in-sandbox guard proves dynamic self-process data and
   denies access to the parent worker's environment, root, working directory,
   and file descriptors. The selected
   frozen capability is cached only for a bounded lifetime against the
   Bubblewrap executable's real path, device, inode, size, and modification
   time. No task or operator environment value may replace the production
   Bubblewrap path or select a proc mode.
   The project path must be authorized against the real workspace before any
   directory creation. Missing components are created without following
   symlinks and the final real path is revalidated before launch. The task
   environment is constructed from an explicit allowlist and excludes
   `PLOINKY_AGENT_API_KEY`, `PLOINKY_AGENT_PRIVATE_SECRET`,
   `PLOINKY_AGENT_CLIENT_SECRET`, `PLOINKY_AGENT_SECRET`,
   `PLOINKY_MASTER_KEY`, invocation/router credentials, and provider secrets.
   In generated-local mode the outer wrapper owns a loopback broker limited to
   the Soul Gateway chat-completions route and the `fast`, `plan`, and `deep`
   models. It injects the signed agent key upstream while the nested task sees
   only the broker URL and a random per-task bearer token. PI registers the same
   broker through its repository-owned provider extension. Outside that mode,
   provider authentication comes from provider-owned persistent state; raw
   Ploinky credentials are never task authority. Capability failure returns
   `PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE` with status and cause before task or
   persistent-state mutation. Provider execution has no elapsed timeout and
   remains active until completion, cancellation, failure, or runtime
   interruption, while retained stdout, stderr, final output, and diagnostics
   remain byte bounded.
   The same contract applies when the Ploinky runtime itself is a container or
   a `lite-sandbox` Bubblewrap process: container profiles must permit nested
   namespaces, the installer must install `bubblewrap` only when `bwrap` is not
   already available, and readiness must prove that a nested sandbox can
   actually start before the agent becomes ready. OpenCode and PI do not request
   privileged containers. Their unprivileged container readiness must pass the
   same non-skipping private/guarded-inherited proc, UID/GID/home,
   writable-path, and real task checks used to qualify the exact Box runtime
   image. Readiness must also launch the provider binary through the selected
   sandbox mode so a runtime that needs a live proc filesystem cannot pass a
   trivial command-only probe.
   For initial
   PI tasks outside generated-local mode, the provider owns model selection.
   Generated-local tasks use the scoped Soul `fast` model unless an allowed
   Soul tier is requested. Before continuation, `piAgent`
   must merge its persistent global settings with project-local PI settings,
   read the effective `defaultProvider`, `defaultModel`, and valid
   `defaultThinkingLevel`, and pass them as explicit CLI overrides while
   retaining the stored session id and directory. Missing or malformed model
   settings fall back to PI's native session-resume behavior. For initial
   OpenCode tasks, the wrapper must assign an unpredictable internal session
   title and resolve the provider session id through the separate session-list
   interface after execution. If that read-only CLI operation cannot run in the
   selected proc mode, the wrapper must query OpenCode's persisted session
   database directly without masking the primary task result; neither lookup's
   output may enter task logs.
   Before continuation, `opencodeAgent` must read the first recent model and
   its non-default variant from its persistent OpenCode state and pass them as
   explicit CLI overrides while retaining the stored session id. Unavailable
   or malformed model state falls back to OpenCode's native resume behavior.
   After resolving an OpenCode session, the wrapper must inspect its exported
   message data outside the visible stream and use the last assistant text as
   `outputText`; export output must never enter task logs. Wrapper stdout is a
   structured result containing final answer text and a generic continuation
   descriptor. A wrapper whose provider session exists must emit and persist
   the same descriptor even when the command exits unsuccessfully. TaskQueue
   exposes only successful `outputText` to ordinary MCP callers and retains the
   descriptor as task metadata for completed, failed, and cancelled running
   tasks. The wrappers abort their provider subprocess on `SIGTERM` and use the
   remaining cleanup window to save that descriptor; they do not synthesize a
   continuation for work cancelled while still queued. Provider session
   ids, session directories, project paths,
   and internal lookup titles must remain behind UUID continuation handles
   stored in agent-private files with restrictive permissions.
9. `codexAgent` must run initial work through `codex exec --json` without
   ephemeral mode and must use the reported Codex thread id for continuation.
   It forwards provider stderr byte-for-byte and extracts agent-message and
   completed command-output text from JSONL events into the live log as those
   events arrive, without prefixes, lifecycle decoration, raw JSON events, or
   structured-result duplication. The last bounded agent message becomes
   `outputText`. Its private continuation record stores only the thread id and
   resolved original project directory; it must not store a model.
   `continue-task` invokes `codex exec resume` in that directory without
   `--model`, so the Codex configuration active for the new turn remains the
   model authority. Both initial and resumed execution place Codex's global
   `--sandbox workspace-write --ask-for-approval never` options before `exec`.
   In generated-local Ploinky mode they also select a fixed custom provider at
   the Router's local Soul Gateway Responses endpoint, reference the generated
   `PLOINKY_AGENT_API_KEY` by environment-variable name, and use the concrete
   `gpt-5.6-sol` model identity as a one-run config default. Soul Gateway maps
   that compatibility alias to its operator-managed `fast` cascade, separating
   Codex capability lookup from routing policy without persisting credentials
   or provider state in the workspace. Partial generated provenance fails before spawn,
   while non-generated invocations retain normal Codex authentication.
   The selected project directory is writable, broader filesystem writes fail
   without prompting, and the wrapper must not bypass Codex's sandbox. On
   controlled cancellation the wrapper aborts Codex and preserves a
   reported thread id behind the existing opaque handle before exiting
   unsuccessfully.
   Its profile installer must install the Codex package and launcher under
   `$HOME/.local`; the manifest and execution runner must resolve the same
   home-relative launcher so container recreation and host-sandbox execution
   share one persistent installation location without writing to `/usr/local`.
   The installer must invoke npm through an absolute CLI path selected for the
   container or mounted Bubblewrap Node runtime, while preserving an explicit
   `NPM_CLI` override for deterministic tests or operator control. Codex MCP
   task commands must invoke `node` through `PATH` rather than assuming a
   container-only `/usr/local/bin/node` path.
10. `launch-gpt-researcher` must ensure `proxies/searchAgent` is running before
   it ensures `AchillesCLI/GPTResearcher` is running. Each check must avoid a
   duplicate `enable_agent` request when Marketplace already reports the agent
   as running. When activation is required, both requests use explicit
   `global` mode; the research MCP call must wait until both runtimes are
   ready.
   The shared runner image used by `GPTResearcher` is accepted only by immutable
   digest after native-platform image inspection plus cold install, readiness,
   and minimal task proof against that exact digest. A mutable tag or an image
   merely present in a local daemon is not rollout or rollback identity.

## Decisions & Questions

### Question #1: Why does the manifest temporarily opt `SOUL_GATEWAY_API_KEY` into explicit override?

Response:
Explorer launches AchillesCLI from selected workspace folders, and current workspaces may carry a hosted Soul Gateway key in a parent `.env`. The manifest opt-in lets Ploinky expose that explicit hosted key to AchillesAgentLib during startup while preserving generated Ploinky agent credentials for the canonical local route. This is a temporary compatibility bridge, not the long-term ecosystem contract.

Temporary implementation offset:

```text
achilles-cli/manifest.json:L6-L10
```

### Question #2: Why is the skills manifest editor shipped by AchillesCLI instead of Explorer?

Response:
The editor changes AchillesCLI-owned skill-management workflow configuration while using Explorer only as the host surface for folder context menus and file persistence. Keeping the plugin under `achilles-cli/IDE-plugins/` lets AchillesCLI own the UX and manifest contract without adding Explorer-specific routes, tools, or policy behavior.

### Question #3: Why is an asynchronous task identified by target agent and task id instead of PID?

Response:
The delegated process is owned by the target AgentServer, often inside another
container. Its PID is local to that runtime and may be reused after restart,
whereas the router-mediated status contract is explicitly keyed by target
agent and AgentServer task id. A PID may be carried as optional diagnostics but
cannot be the reattachment authority.

### Question #4: Why does terminal `/tasks` read the AchillesCLI task journal instead of querying the router?

Response:
The journal and bounded task logs are already the durable workspace record,
and the AchillesCLI process has access to that workspace in both modes. Direct
read-only inspection avoids adding an authenticated router API for a local CLI
operation. Blocking callers use `AgentMcpClient.callTool`; launcher skills
intentionally use the separate non-blocking method observed by AchillesCLI in
single-shot, terminal, and WebChat modes.

### Question #5: Why is Soul Gateway model discovery performed by the command-catalog tool?

Response:
The MCP catalog tool already supplies agent-owned slash metadata to WebChat and runs inside AchillesCLI's authenticated server context. Fetching Soul Gateway there keeps the generated agent credential out of the browser, preserves one generic WebChat contract, and lets the selected agent decide which models and recommendation metadata it exposes.

### Question #6: Why are optional workers omitted from the AchillesCLI manifest?

Response:
Ploinky recursively expands manifest `enable` dependencies, so listing coding and research workers there makes every Explorer session pay their startup cost even when no launcher uses them. Omitting those entries breaks the dependency chain, while `startup: manual` prevents already registered but dormant workers from joining later general boots. The launcher restores availability at the actual invocation boundary through a status-first Marketplace enable flow and explicitly chooses global mode for these workspace-scoped coding and research tasks. Soul Gateway remains the only automatically enabled dependency required for core AchillesCLI model discovery, but it starts asynchronously because it has no implicit primary-service readiness route.

### Question #7: Why does AchillesCLI forward an opaque handle instead of a provider session id?

Response:
OpenCode and PI have different session identifiers and storage layouts.
AchillesCLI only needs a generic capability to describe resumable work, while
the provider agent must retain authority over its own session files and project
directory. The opaque handle keeps those details out of WebChat and lets the
router bind continuation to the stored target agent and tool through the normal
MCP policy path.

### Question #8: Why does PI continuation resolve model settings inside the provider agent?

Response:
WebChat's continuation input is provider-neutral and must not gain PI-specific
provider, model, or thinking arguments. The PI interactive CLI and `piAgent`
share persistent provider storage, while project-local PI settings may override
global defaults. Resolving those settings immediately before continuation and
passing explicit CLI flags preserves the current PI selection instead of the
older model restored from the session. Invalid settings leave PI's native
resume selection intact.

### Question #9: Why does Copilot use both a Tools entry and a directory context-menu entry?

Response:
The directory context menu is precise when a child folder row exists, but Explorer's workspace root has no selectable row. The Tools entry targets the directory currently displayed by Explorer, which makes the workspace root actionable without exposing its parent. Both surfaces share one plugin id so installation and workspace plugin policy still treat them as one AchillesCLI-owned capability.

## Conclusion
AchillesCLI is a first-class runtime component inside a larger ecosystem; integration quality depends on explicit boundaries with Ploinky orchestration, AchillesAgentLib runtime semantics, and AchillesIDE interoperability expectations.
