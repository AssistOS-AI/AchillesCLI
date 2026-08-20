---
title: DS006-ui-system
summary: Specifies terminal UI components, rendering contracts, and provider abstractions.
---

## Introduction
This DS defines AchillesCLI user-interface architecture under `src/ui/`, including rendering utilities, selectors, editor behavior, help flows, and provider abstraction.

## Core Content
UI component contracts:
1. `CommandSelector.mjs`
   - Provides keyboard-driven selector experiences for commands, skills, tests, help topics, and repositories.
   - Supports filtering, navigation, and explicit selection output.
2. `LineEditor.mjs`
   - Implements advanced terminal input editing behavior.
   - Supports cursor movement, insertion/deletion, and command-line editing ergonomics.
3. `HelpSystem.mjs` and `HelpPrinter.mjs`
   - Generate and display command help and topic-specific assistance.
4. `MarkdownRenderer.mjs`
   - Converts markdown-like responses into terminal-friendly formatted output.
5. `spinner.mjs`
    - Provides progress indication and operation feedback for longer tasks.
    - Displays interruption hints for cancel-capable flows.
6. `ResultFormatter.mjs`
   - Normalizes execution results into user-facing terminal output.
7. `themes/`
   - Defines color/icon/box style behavior for UI presentations.

Provider architecture:
1. `providers/BaseUIProvider.mjs`
   - Defines abstract UI capabilities: input, output, spinner, banner, help.
2. `providers/ClaudeCodeUIProvider.mjs`
   - Implements rich interactive terminal UX, selector integrations, and boxed startup layout.
3. `providers/MinimalUIProvider.mjs`
   - Implements low-friction plain-text UX suitable for non-TTY and reduced-render contexts.
4. `providers/index.mjs`
   - Maintains provider registry and provider factory behavior.
5. `UIContext.mjs`
   - Stores active provider globally and exposes theme/provider lookup.

Interaction invariants:
1. UI rendering concerns remain separated from business logic and skill execution.
2. Provider swapping must not require command-handler rewrites.
3. Output formatting must remain safe for normal terminal and scripted consumption.
4. Interrupt-capable operations must keep terminal mode and cursor state consistent after ESC cancellation.

## Conclusion
The UI subsystem is a layered terminal interaction framework with provider pluggability, reusable rendering components, and explicit boundaries from core execution logic.
