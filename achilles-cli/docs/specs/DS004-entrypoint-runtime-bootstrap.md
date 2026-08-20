---
title: DS004-entrypoint-runtime-bootstrap
summary: Defines local installation, trusted startup, dependency resolution, and execution-mode selection.
---

## Introduction

This DS owns the path from the `achilles-cli` executable to a ready sandboxed agent. It does not define interactive commands, model policy, session semantics, or provider-worker internals.

## Core Content

The package must support Node.js 20 or newer, declare AchillesAgentLib as a package dependency, expose `bin/achilles-cli`, and provide `npm start` as the repository entry path. A standalone checkout must become locally runnable through `npm install` plus the prerequisite script; Ploinky dependency caches are optional to this path.

`src/cli.mjs` must resolve the selected workspace and supported CLI options before starting the trusted broker. `--dir` selects the workspace, `--skill-root` adds read-only skill roots, and `--permissions` accepts only `ask-for-approval` or `full-access`. An explicit permission option applies to that process; otherwise startup restores the workspace value and falls back safely when it is absent or invalid.

Startup must then create one persistent Bubblewrap namespace and run `src/index.mjs` inside it. The sandbox exposes required system runtime paths, read-only AchillesCLI code and dependencies, isolated temporary storage, the broker socket, and the selected workspace as the writable project tree. Network access remains shared. Startup must fail closed when Bubblewrap, the broker connection, required dependencies, or the process-namespace safety checks are unavailable.

The sandboxed entrypoint must resolve AchillesAgentLib from supported runtime mounts, explicit overrides, parent paths, or `node_modules` without hardcoded workstation paths. It must construct `MainAgent`, register built-in and discovered skill roots, apply persisted workspace settings, and then choose exactly one mode.

| Input condition | Execution mode |
| --- | --- |
| Prompt argument | Execute once and exit after the result. |
| WebChat runtime identity | Start the structured stdin/stdout WebChat loop. |
| Neither condition | Start the interactive terminal REPL. |

Startup may load the selected conversation and attach the workspace task observer so the chosen mode begins with durable state. Detailed conversation behavior belongs to [DS005](specsLoader.html?spec=DS005-repl-and-command-processing.md), while the cross-process security boundary belongs to [DS013](specsLoader.html?spec=DS013-global-architecture.md).
