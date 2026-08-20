---
title: DS003-main-behavior
summary: Defines the prompt, skill, workspace-safety, and delegated-task behaviors that produce AchillesCLI's primary user outcome.
---

## Introduction

AchillesCLI lets a user complete project work from a local terminal or Ploinky WebChat. The same workspace-aware agent accepts prompts and commands, applies reusable skills, confines command execution, and can continue long-running work through external agents.

## Core Content

### Main Behavior Components

| Name | Explanation |
| --- | --- |
| Prompt execution across CLI surfaces | A user submits work in single-shot, REPL, or WebChat mode and receives a result from the same skill-aware runtime. |
| Skill lifecycle and execution | A user discovers, manages, and executes reusable skills that turn requests into project operations. |
| Workspace-confined Bash execution | Approved commands can change the selected workspace without gaining access to sibling projects or broader host files. |
| Persistent delegated tasks | A user starts, inspects, stops, and continues asynchronous work while AchillesCLI preserves one local task identity. |

### Prompt execution across CLI surfaces

A prompt argument starts one single-shot execution, an invocation without a prompt starts the terminal REPL, and a Ploinky WebChat launch starts the structured input loop. Every mode creates an AchillesAgentLib `MainAgent`, restores workspace state, registers applicable skills, routes model calls under [DS002](specsLoader.html?spec=DS002-llm-model-strategy.md), and returns the final result through the active interface. Interface-specific input and rendering must not change the execution contract.

### Skill lifecycle and execution

Slash commands and natural-language planning let a user inspect, create, validate, generate, test, refine, enable, disable, and execute skills. AchillesCLI discovers built-in and workspace roots, validates skill documents, and refreshes the active catalog after mutations. The resulting artifact or execution result must follow the descriptor contract owned by [DS007](specsLoader.html?spec=DS007-skills-runtime-and-builtins.md) and [DS008](specsLoader.html?spec=DS008-schemas-and-skill-doc-contract.md).

### Workspace-confined Bash execution

The trusted broker authorizes Bash requests, while the approved process starts as a child of the Bubblewrap-confined MainAgent. Approval may permit a command but must never widen the selected workspace boundary. Denial must return an ordinary tool result so planning can continue. [DS013](specsLoader.html?spec=DS013-global-architecture.md) owns the architectural security boundary.

### Persistent delegated tasks

A named launcher can activate a supported worker through Ploinky, submit work asynchronously, and return control to the conversation. AchillesCLI stores the generic task journal and logs under `.achilles-cli/tasks/`, exposes lifecycle actions through `/tasks` and `/task view|stop|continue`, and retains one local task identifier across continuation turns. The worker keeps provider-specific sessions and credentials private; [DS010](specsLoader.html?spec=DS010-ecosystem-integration.md) and [DS012](specsLoader.html?spec=DS012-launch-agent-skills.md) define the integration boundaries.
