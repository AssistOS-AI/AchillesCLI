---
title: DS002-task-sandbox-and-runtime
summary: Defines PI Agent's nested Bubblewrap namespace, provider process, model routing, and persistent session architecture.
---

## Introduction

PI Agent runs inside a Ploinky worker boundary and creates a second, task-specific Bubblewrap namespace for each delegated provider process. The inner namespace protects sibling projects and worker credentials from one PI task.

## Core Content

| Component | Responsibility |
| --- | --- |
| Task sandbox | Validates `PLOINKY_WORKSPACE_ROOT` and `projectDir`, probes supported proc behavior, mounts the project and required PI state, and filters the task environment. |
| PI runner | Starts PI in JSON event-stream mode with an explicit session identifier and directory. |
| Event parser | Publishes assistant and textual tool output, removes duplicates, and derives final answer or provider error. |
| Continuation store | Maps an opaque UUID to the original project, PI session identifier, and session directory. |
| Model resolver | Merges persistent global PI settings with project-local settings before continuation. |
| Scoped Soul broker | Provides generated-local model access through a task-scoped loopback credential without forwarding the raw Ploinky agent key. |

The sandbox must resolve the real workspace before project creation, reject traversal and symlink components, create missing project directories without following links when initial execution permits creation, and revalidate the final real path. The canonical project directory must be the only writable project bind. System and runtime files must be read-only, while PI configuration and session paths may receive only the writes required for normal operation.

The proc mode must be selected by a frozen capability probe, not by task input or environment. Private proc is preferred. A guarded inherited-proc mode is permitted only when an in-sandbox check proves dynamic self-process data and denies access to parent process environment, roots, working directories, and descriptors. Failure must return `PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE` before project or session mutation.
