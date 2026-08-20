---
title: DS007-skills-runtime-and-builtins
summary: Defines skill discovery, execution flow, and built-in skill responsibilities.
---

## Introduction
This DS defines how AchillesCLI discovers, validates, executes, and refreshes skills, including the shipped built-in skill modules.

## Core Content
Skill runtime model:
Skill discovery is managed by AchillesAgentLib `MainAgent`.

AchillesCLI supplies built-in roots and optional external roots.

In Ploinky workspaces, AchillesCLI also discovers launcher skills from workspace-managed repository clones under `.ploinky/repos/<repo>/achilles-skills` without hardcoding repository names or agent ids.

Later external roots may replace built-in fallback skills with the same normalized name; this is how a deployed provider launcher supersedes an unavailable placeholder.

Skill catalogs are reloadable at runtime after mutation operations.

Every workspace skill is enabled by default. AchillesCLI persists only canonical disabled names and reapplies them when a MainAgent is created.

Built-in skill responsibilities (`src/skills/`):
### Catalog and inspection
`list-skills`

`read-skill`

`read-specs`

### Authoring and mutation
`write-skill`

`write-specs`

`update-section`

`delete-skill`

### Validation and scaffolding
`validate-skill`

`get-template`

`preview-changes`

### Code-generation and execution
`generate-code`

`test-code`

`execute-skill`

`skill-refiner`

`launch-codex`

`launch-opencode`

### Test-generation helpers
`write-tests`

`run-tests`

### Local execution
`bash` parses a command without a shell and delegates execution to the local executor inside MainAgent.

The Bash skill contains no risk classifier, approval prompt, permission memory, or direct process launcher.

The local executor is mandatory, inherits MainAgent's Bubblewrap namespace, starts the requested executable directly as a child process, and fails closed when unavailable.

After authorization, the executor captures stdout and stderr without forwarding them to the AchillesCLI process streams. Bash returns the ordinary execution output or error only to the agentic session and does not expose one-time or reusable approval state.

A pre-execution denial is resolved by the Supervisor before Bash is invoked. AchillesAgentLib records the exact tool name, exact parameters, and denial reason as the tool result and resumes the planner without calling this skill.

Execution behavior:
Slash commands target specific deterministic skill utilities.

Natural-language prompts may route through orchestrator logic to compose multi-step skill plans.

Skill mutation paths must preserve schema/contract validation behavior.

Catalog and refresh invariants:
Skill writes/deletes must synchronize catalog state through explicit reload paths.

Aliases and command exposure remain deterministic after reload.

Errors in skill loading must surface actionable diagnostics.

Runtime refreshes reload already-registered roots; startup discovery is responsible for finding the active root set from built-ins, CLI flags, node_modules, and Ploinky repo `achilles-skills` roots.

Permission policy is infrastructure owned by the external broker and Supervisor, never by skill code.

Directory expansion and confinement belong to AchillesCLI; MainAgent receives only canonical name arrays through `enableSkills()` or `disableSkills()`.

Disabled records remain listable but cannot execute, build, or participate in MainAgent or orchestrator tool surfaces.

### Rationale and Boundaries

Permission policy must remain authoritative for natural-language calls, direct slash execution, and future callers. Centralizing authorization in the trusted broker prevents a skill-local prompt or environment flag from bypassing approval. Workspace confinement is independently enforced because the local executor is already inside MainAgent's Bubblewrap namespace, while the skill remains responsible only for deterministic parsing and result formatting.

Approval is control-plane state used only to decide whether the handler may run. Once allowed, the handler follows the same result contract as any ordinary invocation, so the planner receives the execution output or error without approval-specific text or metadata.
