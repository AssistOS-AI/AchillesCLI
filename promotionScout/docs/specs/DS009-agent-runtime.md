---
title: DS009-agent-runtime
summary: Defines the promotionScout Ploinky agent: identity and manifest, router-mediated access, the persisted monitoring protocol between tools and the agent daemon, and monitoring cycles as asynchronous scout_run_cycle tasks.
---

## Introduction

Promotion Scout runs as a [Ploinky agent](../wiki.html#definition-ploinky-agent) so that the operator reaches it through the workspace router and its monitoring keeps running without an operator's terminal. Short [MCP tool](../wiki.html#definition-mcp-tool) processes change and read state, the [agent daemon](../wiki.html#definition-agent-daemon) turns the saved monitoring state into cycles, and each cycle runs as a [cycle task](../wiki.html#definition-cycle-task) of the Ploinky task queue, whose log the operator follows live.

## Core Content

### Identity and manifest

The agent directory is `promotionScout` in the AchillesCLI repository, so its agent id is `agent:AchillesCLI/promotionScout` and its router route is `/promotionScout`. The identity, route and tool names are durable: callers, router policy and the web interface depend on them, so a change requires a migration of every dependent route, policy entry and caller.

`manifest.json` must declare the `docker.io/assistos/ploinky-node` image pinned by digest, the agent command `sh /code/scripts/startAgent.sh`, `readiness.protocol` `mcp` with a `health.readiness` budget large enough for the first installation (900 probes at a two-second interval and timeout), the volume `.data/promotionScout` mounted at `/data`, and `profiles.default.install` `sh /code/scripts/install.sh`. It declares no ports, `routerAccess` entries, HTTP services, secrets or environment values: the router reaches AgentServer on its default port, the web interface is served as static files, and RSSHub stays inside the container. The agent code at `/code` is read-only; every write goes to `/data`. [DS006](DS006-lifecycle.md) defines the install step, the start script and service ownership.

`mcp-config.json` declares 21 user tools, each `node tools/scout.mjs <operation>` with `cwd` `/code`, and the internal tool `scout_run_cycle`. Every tool sets an explicit `cwd`, because AgentServer otherwise runs commands in its own working directory, and an input schema with `additionalProperties: false` using only the JSON Schema keywords AgentServer accepts. [DS007](DS007-web-interface.md) defines the user tools.

### Router-mediated access

The router is the only entry point. It authenticates the user for the pages under `/promotionScout/`, for `/promotionScout/mcp` and for `/promotionScout/task`, applies MCP tool policy and mints the invocation token AgentServer verifies for every call. The agent never receives a user's session token and never checks credentials itself. User tools have no tags, which makes them `authenticated`: callable by signed-in users, not by guests. `scout_run_cycle` is tagged `internal`, which makes it callable only by agents; administrators do not gain access to it.

The daemon calls `scout_run_cycle`, reads its status and cancels it through the router with the Ploinky `AgentMcpClient` from `/Agent/client/AgentMcpClient.mjs`, which signs each request with the agent's own `PLOINKY_AGENT_SECRET`. It is a call from the agent to itself: the router verifies the assertion and policy exactly as for any agent-to-agent call. Task status is not bound to the caller, so the browser can read the log of a task the daemon started by its id, which `scout_status` publishes; the router still requires an authenticated user for that read.

### Monitoring protocol

Monitoring state lives only in SQLite `settings` rows, as [DS002](DS002-architecture.md) lists, so tools, tasks and the daemon need no shared memory and the state survives restarts. `scout_monitor_start` turns monitoring on with the chosen interval and no recorded start; `scout_monitor_stop` turns it off. Neither tool starts or stops a process.

The daemon runs a loop every two seconds. When the last RSSHub check is at least 30 seconds old it checks RSSHub again. It then follows the cycle: when a task is recorded it reads that task's status; otherwise, when monitoring is on and the current time has reached both the due time and any retry time, it calls `scout_run_cycle` with an empty input, requires a task id in the result (`CYCLE_START_FAILED` otherwise) and records the id and the start time in one transaction. Finally it writes its heartbeat, `{pid, heartbeatAt, services}`. Any failure of the cycle step, such as a router or AgentServer that is not ready yet, is reported and postpones the next attempt by 30 seconds; a failure never ends the daemon.

A recorded task that is `completed`, `failed`, `cancelled` or unknown (a 404 from a restarted task queue) ends the cycle: in one transaction the daemon marks runs left `running` as `interrupted`, clears the recorded task and keeps its id as the last cycle task. While the task runs and monitoring is on, nothing happens. While it runs after Stop, the daemon waits 60 seconds for the task to abort by itself and then cancels it, repeating the cancellation every 60 seconds until the task ends. Only one cycle can run at a time because the daemon starts a cycle only when no task is recorded and Start refuses while one is.

The next cycle is due the chosen interval after the previous one started, or as soon as the previous one ends when it took longer. After an agent restart the recorded task is followed like any other, so a task lost with AgentServer ends the cycle as unknown or failed and the schedule continues from its recorded start.

### Cycle task

`scout_run_cycle` is declared with `async: true`, a 12-hour `timeoutMs` and `taskLogRetention: full`. AgentServer queues it, returns its task id at once and runs `node tools/run-cycle.mjs` in its own process. The process opens its own context, runs one [run](../wiki.html#definition-run) with `runCycle` from `src/app/monitor.mjs` and prints `{run, status, stats, errors}` as the task result. Progress lines go to standard error as `<ISO time>  <message>`, with control characters removed, and form the task's log. The embedding model is created inside the task and disposed of when the run ends.

The task reads the monitoring flag every two seconds and aborts the run with `ABORTED` when it is off; SIGTERM or SIGINT, which task cancellation sends, abort it the same way. An aborted run keeps its record with status `aborted`. The task never launches RSSHub: when a due feed needs it, the run waits for RSSHub's health endpoint up to the configured startup timeout and otherwise fails only the RSSHub feeds with `SERVICE_UNAVAILABLE`. A missing or failing model fails the run as [DS004](DS004-embeddings.md) defines.

### Limitations

The task queue keeps a task's log in memory and keeps only its status across an AgentServer restart, so the cycle log of an interrupted or earlier task can be lost while the run record remains. The agent does not run a cycle on demand outside the schedule; Start makes the first cycle due immediately. Cancelling a task through means other than Stop, such as an administrator cancelling it in Ploinky, aborts only that cycle: monitoring stays on and the next cycle is due at the usual time.
