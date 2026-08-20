---
title: DS008-schemas-and-skill-doc-contract
summary: Defines skill-document detection, validation, templates, updates, and sidecar specifications.
---

## Introduction

This DS owns the Markdown contract interpreted by `src/schemas/skillSchemas.mjs`. It does not define how MainAgent discovers or executes a valid skill.

## Core Content

Schema utilities must detect a supported skill family from its document structure and known headings. Validation must distinguish required and optional sections, report missing or invalid content explicitly, and preserve the expected section order when a targeted update rewrites one section.

| Operation | Required result |
| --- | --- |
| Detect | Return the supported descriptor family established by the document. |
| Validate | Return actionable contract violations without changing the source. |
| Template | Produce a schema-valid starting document for the requested family. |
| Section update | Change the requested supported section while preserving unrelated valid content. |
| Sidecar read | Load optional Markdown files under the skill's `specs/` directory on demand. |

Every skill family may include an optional `## Help` section containing user-facing invocation guidance. Runtime execution logic must not be derived from that help text. Templates should include useful help examples when the family supports them.

A missing `specs/` directory is valid. When present, sidecar files may contribute to reading, generation, or refinement flows, but they must not replace the primary skill descriptor or relax its validation rules.

Any change to required headings, supported families, templates, or section ordering must update the schema implementation, built-in authoring commands, and documentation together.
