---
title: DS000-vision
summary: Defines PI Agent's purpose, resumable task outcome, and task-level security boundary.
---

## Introduction

PI Agent makes the PI coding agent available through Ploinky for native CLI use and asynchronous delegated work. Its defining result is a provider session that can change one authorized project, stream useful output, and continue through later task turns.

## Core Content

PI Agent must expose the installed PI CLI through `ploinky cli piAgent` and must expose internal asynchronous task tools for AchillesCLI. Delegated execution must preserve the PI session behind an opaque handle so the browser and orchestrator do not receive provider session identifiers or private storage paths.

| Product boundary | Required outcome |
| --- | --- |
| Filesystem | Each delegated provider process sees the selected project as the only writable project bind. |
| Continuity | Initial, failed-after-session, and controlled-cancellation tasks remain continuable when a provider session exists. |
| Output | Assistant text and textual tool output stream without lifecycle, thinking, signature, encrypted, or usage records. |
| Model state | Initial work uses authorized input or PI-owned selection; continuation resolves current global and project settings. |
| Credentials | Raw Ploinky and provider credentials remain outside the task environment and continuation record. |

The worker must remain manual and must fail closed when the task-local Bubblewrap sandbox cannot be established. Provider work may use network access, but it must not receive writable access to sibling projects or the full workspace root.
