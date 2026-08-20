---
title: DS008-schemas-and-skill-doc-contract
summary: Defines skill schema detection, validation rules, templates, and `specs/` integration.
---

## Introduction
This DS specifies how AchillesCLI interprets skill documents and sidecar specifications through schema utilities in `src/schemas/skillSchemas.mjs`.

## Core Content
Schema utility responsibilities:
Detect skill type from document structure and known section headers.

Validate required vs optional sections by skill family.

Provide canonical template structures for supported skill types.

Validate update operations that target specific sections.

Document contract:
Skill documents are markdown-based contract files.

Validation output must be explicit about missing/invalid sections.

Read and write paths must preserve document integrity and expected section order where applicable.

All skill families may include an optional `## Help` section. This section is user-facing invocation guidance and is not used as runtime execution logic.

`specs/` sidecar contract:
Skills may include optional Markdown files under `specs/`.

Sidecar specifications are loaded on demand and included in relevant generation/refinement/read flows.

Missing `specs/` directories are valid and must not break normal skill execution.

Operational invariants:
Schema rules must stay synchronized with built-in skill authoring and validation commands.

Template generation must produce schema-valid initial structures.

Template generation must include `## Help` examples that explain how to invoke the generated skill from user-facing command surfaces.

Contract changes to required sections must be reflected in both validation logic and documentation.
