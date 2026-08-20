---
title: DS002-task-sandbox-and-provider-runtime
summary: Defines OpenCode Agent's nested sandbox, provider process, session discovery, Soul configuration, and endpoint architecture.
---

## Introduction

OpenCode Agent runs inside a Ploinky worker and creates a task-local Bubblewrap namespace for provider execution. It also acts as a Ploinky model provider, so the runtime must distinguish resumable task sessions from stateless chat-completions calls.

## Core Content

| Component | Responsibility |
| --- | --- |
| Task sandbox | Confines execution to a canonical project, mounts required OpenCode state, filters secrets, and proves a safe proc mode. |
| OpenCode runner | Executes native formatted output with `--auto`, optional session and model flags, bounded retention, and cancellation. |
| Session resolver | Finds an initial session by unpredictable title and project, with a read-only database fallback when CLI listing is unavailable. |
| Session exporter | Reads provider messages outside the visible stream and selects the last assistant text as `outputText`. |
| Continuation store | Maps an opaque UUID handle to the private provider session and original project directory. |
| Provider endpoints | Convert OpenAI messages to a prompt, run chat completions in `WORKSPACE_PATH`, and publish exact OpenCode model descriptors. |

The canonical project must remain inside `PLOINKY_WORKSPACE_ROOT`. The sandbox must reject traversal, symlinks, changing real paths, missing authority, and unsupported proc behavior before task or persistent-state mutation. The project is the only writable workspace bind; the OpenCode configuration, cache, data, and state paths may receive the minimum separate writes required by the provider.

The installed configuration must define the scoped Soul Gateway provider without writing resolved router URLs or keys into repository files. It must expose `fast`, `plan`, and `deep`, preserve other providers and recent selections, set the global permission default to allow, and override external-directory access to deny.
