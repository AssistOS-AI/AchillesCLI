---
title: DS006-lifecycle
summary: Defines the agent's install step, the start of AgentServer and the agent daemon, RSSHub ownership, the lifecycle lock and shutdown with the container.
---

## Introduction

Ploinky prepares and starts Promotion Scout as one container. Before every start the [install step](../wiki.html#definition-install-step) brings the [data directory](../wiki.html#definition-data-directory) to a usable state; the start script then runs the bundled Ploinky AgentServer and the [agent daemon](../wiki.html#definition-agent-daemon) side by side. Services the daemon starts live as long as it does.

## Core Content

### Installation

The manifest declares `profiles.default.install` as `sh /code/scripts/install.sh`. Ploinky runs it in the container, in front of the agent command, at every start, so the step must be idempotent and quick when everything is in place. The wrapper sets `SCOUT_DATA_DIR=/data` and runs `scripts/install.mjs`, which checks the Node.js version and calls `bootstrap()` in `src/app/bootstrap.mjs`.

Ploinky prepares the npm dependencies declared in `package.json` in a read-only tree mounted at `/code/node_modules` and named by `NODE_PATH`; the install step never runs npm for them. It first checks that every declared package is present in either location and otherwise stops with `SETUP_REQUIRED`, naming the missing packages, before creating any file. Then, under the lifecycle lock, it writes `config.json` with its defaults when it is missing, opens and closes SQLite so the schema exists, loads the selected local model and downloads model files only when loading reports `MODEL_UNAVAILABLE`, and installs RSSHub. Invalid provider configuration and inference errors do not trigger a substitute model. A failing model or RSSHub stage keeps the other stage's result and stops with `SETUP_INCOMPLETE`, which prevents the agent from starting; the next start retries it.

The pinned RSSHub revision is declared in `config/services/install.json`. The managed source lives under the data directory's `services/rsshub`. RSSHub uses a local pnpm installation, its frozen upstream lockfile and a native build. No system package manager or global installation runs. Git, npm, Python (for native module builds) and a C/C++ build toolchain must be available; the manifest's `assistos/ploinky-node` image supplies them with Node.js 24, and the pinned RSSHub release requires Node 22.22.2+ within v22 or 24.15+ within v24. Browser downloads are skipped; routes requiring a browser need separate setup.

An installation checkpoint is written after expected outputs exist. Repeated installation reuses completed stages and retries incomplete ones. Source checkout conflicts fail without resetting files. Custom service launch commands and configured external services are preserved. Installation commands write `runtime/rsshub-install.log` and have a fifteen-minute per-command timeout. Repairing a managed service while a Scout-owned process of it is running fails. Managed commands contain absolute paths under `/data`, so a data directory is tied to that mount point.

The first start downloads about 309 MB of model files and builds RSSHub, which takes several minutes. The manifest's readiness budget, 900 probes of up to four seconds each, allows about an hour before Ploinky gives up waiting for the MCP endpoint.

### Agent start

The manifest's agent command is `sh /code/scripts/startAgent.sh`. It exports `SCOUT_DATA_DIR=/data`, starts `/Agent/server/AgentServer.sh` and `node /code/src/agent/main.mjs` in the background and checks both every second. When either exits, the script stops the other and exits with a nonzero status, ending the container; Ploinky's restart policy applies from there. Tool processes inherit `SCOUT_DATA_DIR` from AgentServer.

The daemon checks the Node.js version and takes the lifecycle lock for its whole life. It opens SQLite, marks runs left `running` as `interrupted`, synchronizes the built-in site catalog, creates a Ploinky agent client for its own route (`AGENT_NAME`, default `promotionScout`) and enters its loop. A second daemon for the same data directory fails with `STARTUP_BUSY`. Starting the agent reads no feed; a cycle starts only when the persisted monitoring state makes one due, as the [agent runtime specification](DS009-agent-runtime.md) defines.

### RSSHub ownership

The daemon checks RSSHub when it starts and then every 30 seconds with `ensureServer`. A service answering `ok` on `/healthz` is reused. Only an unavailable HTTP endpoint at localhost or 127.0.0.1 with a root base path can be launched locally. A remote endpoint is checked but never launched or stopped locally. An occupied port with an unexpected response is an explicit conflict. Every failure is recorded in the daemon heartbeat, reported once in the agent log and retried at the next check; it fails only the RSSHub feeds of runs in the meantime. Runs never launch RSSHub: they wait for its health endpoint up to the configured startup timeout.

Each service launch uses an executable and argument array, a working directory and optional environment settings. Commands must remain in the foreground; the daemon creates detached process groups itself. Managed RSSHub uses memory caching, binds to loopback inside the container and is not exposed through the router. Readiness has a bounded timeout; failed starts are cleaned up and report their log path.

### Ownership and shutdown

Linux `/proc` supplies the process start time and boot identity stored with each owned PID under `runtime/`. Shutdown verifies those values before sending signals, so stale records do not target a reused PID. Shutdown uses SIGTERM for the whole process group and then SIGKILL if a verified process does not exit. Existing external servers never become owned merely because they answer a readiness probe.

SIGINT, SIGTERM, SIGHUP and unhandled errors stop the daemon's loop. It then stops every verified Scout-owned service recorded under `runtime/`, closes SQLite and releases the lock; an unhandled error exits with status 1. A running [cycle task](../wiki.html#definition-cycle-task) belongs to AgentServer and ends with it; its run is marked `interrupted` at the next daemon start. Monitoring state, sources, model files, installation checkpoints and SQLite are preserved, so a restarted agent resumes monitoring if it was on.

Runtime logs, process records and the lifecycle lock live under `runtime/` in the data directory. The daemon holds the lock from startup to exit, and the install step takes it for its whole duration before the daemon starts, so the two cannot overlap. Tool calls and cycle tasks never take the lock. The lock records the owner's PID, process start time and boot identity; when that process no longer exists, because it was killed, crashed or ran before a container restart, the next daemon or install step removes the lock, reports it and continues. A corrupt lock file is treated the same way. A live owner, including a reused PID, is never displaced: identity checks distinguish it, and the command fails with `STARTUP_BUSY`. Processes that daemonize outside their original group are outside the supported launch contract.

### Documentation server

The HTML documentation must work as static files served over HTTP, including shared navigation and specification Markdown. From the `promotionScout` directory, `python3 -m http.server 8000 --bind 127.0.0.1 --directory docs` serves it on loopback; the Repository menu's links to the AchillesCLI overview resolve when the AchillesCLI directory is served instead. This command must not start application services or inference. Diagrams load the documented Mermaid CDN module; the surrounding HTML remains readable if diagram rendering is unavailable.

### User-visible results

The install step and the daemon report progress on standard error, prefixed `[promotionScout install]` and `[promotionScout]`, in the agent's container log. The Monitor tab shows the daemon heartbeat, RSSHub health with the daemon's last service error, and the live cycle log. The default workflow requires no API credentials. Service readiness does not guarantee RSSHub route success or the availability of the watched sites. Collection failures retain the provider error behavior defined by the provider specification.
