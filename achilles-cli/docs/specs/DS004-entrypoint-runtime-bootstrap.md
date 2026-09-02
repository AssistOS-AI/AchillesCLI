---
title: DS004-entrypoint-runtime-bootstrap
summary: Defines local installation, trusted startup, dependency resolution, and execution-mode selection.
---

## Introduction

This DS owns the path from the `achilles-cli` executable to a ready sandboxed agent. It does not define interactive commands, model policy, session semantics, or provider-worker internals.

## Core Content

The managed agent manifest must pin the shared Ploinky Node image by digest. That image provides Node 24 on Debian Trixie with a maintained Git/libcurl stack and verified native amd64 and arm64 Git/npm transport. Git retains its default HTTP negotiation.

The package must support Node.js 20 or newer, expose `bin/achilles-cli`, and provide `npm start` as the repository entry path. It must not declare, install, or clone AchillesAgentLib. Ploinky must expose its one workspace-selected AgentLib source through the standard package link. A standalone development checkout must use an explicit link to its selected AgentLib checkout after `npm install` and the prerequisite script.

`src/cli.mjs` must resolve the selected workspace and supported CLI options before starting the trusted broker. `--dir` selects the workspace, `--skill-root` adds read-only skill roots, and `--permissions` accepts only `ask-for-approval` or `full-access`. An explicit permission option applies to that process; otherwise startup restores the workspace value and falls back safely when it is absent or invalid.

Startup must then create one persistent Bubblewrap namespace and run `src/index.mjs` inside it. The sandbox exposes required system runtime paths, read-only AchillesCLI code and dependencies, isolated temporary storage, the broker socket, and the selected workspace as the writable project tree. Network access remains shared. Startup must fail closed when Bubblewrap, the broker connection, required dependencies, or the process-namespace safety checks are unavailable.

The sandboxed entrypoint must resolve AchillesAgentLib from the single source exposed by the hosting runtime through standard bare-package resolution. An explicit development link may provide that source outside Ploinky. The entrypoint must not search for, install, or clone a competing checkout and must not embed a workstation path. It must construct `MainAgent`, register built-in and discovered skill roots, apply persisted workspace settings, and then choose exactly one mode.

| Input condition | Execution mode |
| --- | --- |
| Prompt argument | Execute once and exit after the result. |
| WebChat runtime identity | Start the structured stdin/stdout WebChat loop. |
| Neither condition | Start the interactive terminal REPL. |

Startup may load the selected conversation and attach the workspace task observer so the chosen mode begins with durable state. Detailed conversation behavior belongs to [DS005](specsLoader.html?spec=DS005-repl-and-command-processing.md), while the cross-process security boundary belongs to [DS013](specsLoader.html?spec=DS013-global-architecture.md).
