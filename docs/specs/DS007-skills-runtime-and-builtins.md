---
id: DS007
title: Skills Runtime and Built-in Skills
status: active
owner: AchillesCLI Maintainers
summary: Defines skill discovery, execution flow, and built-in skill responsibilities.
---

# DS007-skills-runtime-and-builtins

## Introduction
This DS defines how AchillesCLI discovers, validates, executes, and refreshes skills, including the shipped built-in skill modules.

## Core Content
Skill runtime model:
1. Skill discovery is managed by AchillesAgentLib `MainAgent`.
2. AchillesCLI supplies built-in roots and optional external roots.
3. In Ploinky workspaces, AchillesCLI also discovers launcher skills from
   workspace-managed repository clones under
   `.ploinky/repos/<repo>/achilles-skills` without hardcoding repository names
   or agent ids.
4. Later external roots may replace built-in fallback skills with the same
   normalized name; this is how a deployed provider launcher supersedes an
   unavailable placeholder.
5. Skill catalogs are reloadable at runtime after mutation operations.

Built-in skill responsibilities (`src/skills/`):
1. Catalog and inspection:
   - `list-skills`
   - `read-skill`
   - `read-specs`
2. Authoring and mutation:
   - `write-skill`
   - `write-specs`
   - `update-section`
   - `delete-skill`
3. Validation and scaffolding:
   - `validate-skill`
   - `get-template`
   - `preview-changes`
4. Code-generation and execution:
   - `generate-code`
   - `test-code`
   - `execute-skill`
   - `skill-refiner`
   - `launch-opencode`
5. Test-generation helpers:
   - `write-tests`
   - `run-tests`

Execution behavior:
1. Slash commands target specific deterministic skill utilities.
2. Natural-language prompts may route through orchestrator logic to compose multi-step skill plans.
3. Skill mutation paths must preserve schema/contract validation behavior.

Catalog and refresh invariants:
1. Skill writes/deletes must synchronize catalog state through explicit reload paths.
2. Aliases and command exposure remain deterministic after reload.
3. Errors in skill loading must surface actionable diagnostics.
4. Runtime refreshes reload already-registered roots; startup discovery is
   responsible for finding the active root set from built-ins, CLI flags,
   node_modules, and Ploinky repo `achilles-skills` roots.

## Conclusion
AchillesCLI skills are the executable core of repository functionality and must remain discoverable, reloadable, and contract-driven across deterministic and orchestrated flows.
