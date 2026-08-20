---
title: DS006-ui-system
summary: Specifies terminal UI components, rendering contracts, and provider abstractions.
---

## Introduction
This DS defines AchillesCLI user-interface architecture under `src/ui/`, including rendering utilities, selectors, editor behavior, help flows, and provider abstraction.

## Core Content
UI component contracts:
`CommandSelector.mjs`

Provides keyboard-driven selector experiences for commands, skills, tests, help topics, and repositories.

Supports filtering, navigation, and explicit selection output.

`LineEditor.mjs`

Implements advanced terminal input editing behavior.

Supports cursor movement, insertion/deletion, and command-line editing ergonomics.

`HelpSystem.mjs` and `HelpPrinter.mjs`

Generate and display command help and topic-specific assistance.

`MarkdownRenderer.mjs`

Converts markdown-like responses into terminal-friendly formatted output.

`spinner.mjs`

Provides progress indication and operation feedback for longer tasks.

Displays interruption hints for cancel-capable flows.

`ResultFormatter.mjs`

Normalizes execution results into user-facing terminal output.

`themes/`

Defines color/icon/box style behavior for UI presentations.

Provider architecture:
`providers/BaseUIProvider.mjs`

Defines abstract UI capabilities: input, output, spinner, banner, help.

`providers/ClaudeCodeUIProvider.mjs`

Implements rich interactive terminal UX, selector integrations, and boxed startup layout.

`providers/MinimalUIProvider.mjs`

Implements low-friction plain-text UX suitable for non-TTY and reduced-render contexts.

`providers/index.mjs`

Maintains provider registry and provider factory behavior.

`UIContext.mjs`

Stores active provider globally and exposes theme/provider lookup.

Interaction invariants:
UI rendering concerns remain separated from business logic and skill execution.

Provider swapping must not require command-handler rewrites.

Output formatting must remain safe for normal terminal and scripted consumption.

Interrupt-capable operations must keep terminal mode and cursor state consistent after ESC cancellation.
