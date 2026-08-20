---
title: DS006-ui-system
summary: Defines terminal input, selection, rendering, help, progress, and UI-provider boundaries.
---

## Introduction

This DS owns presentation under `src/ui/`. UI modules may collect input and render state, but they must not decide command semantics, model routing, skill policy, or task persistence.

## Core Content

| Component | Responsibility |
| --- | --- |
| `CommandSelector.mjs` | Filters and selects commands, skills, tests, repositories, and help topics through keyboard input. |
| `LineEditor.mjs` | Provides cursor movement, insertion, deletion, and editable terminal input. |
| `HelpSystem.mjs` and `HelpPrinter.mjs` | Build and display command and topic guidance from the active command contract. |
| `MarkdownRenderer.mjs` and `ResultFormatter.mjs` | Convert execution results into safe terminal output. |
| `spinner.mjs` | Presents progress and interruption hints for long-running work. |
| `themes/` | Defines visual tokens without changing runtime behavior. |
| UI providers | Adapt the same input, output, banner, help, and progress operations to rich or minimal terminals. |

`BaseUIProvider` must define the provider contract. `ClaudeCodeUIProvider` may provide rich terminal interaction, while `MinimalUIProvider` must remain suitable for non-TTY or reduced-format output. `UIContext` may select the active provider, but command handlers must not depend on a concrete provider.

Rendering must preserve the meaning of results, avoid leaking internal control records, and remain safe for scripted consumption when the minimal provider is active. Selector cancellation and ESC interruption must restore cursor visibility, input mode, and terminal state. UI modules may show progress or choices, but the executing subsystem remains the authority for state and outcomes.
