# AKU Memory

## Summary
Perform deterministic Agentic Knowledge Unit memory actions through the AchillesCLI AKU adapter.

## Description
Use this only for durable local memory operations that the user explicitly requested or that are clearly implied by a durable work task. It wraps public AgenticKnowledgeUnits APIs and does not read or write `.aku` internals directly.

## Input Format
JSON object with an `operation` field.

Common operations:

```json
{"operation":"initialize","metadata":{"name":"Project memory"}}
{"operation":"createKU","metadata":{"ku_name":"Parser experiment","ku_type":"experiment","summary":"Test parser behavior"}}
{"operation":"recordResult","kuId":"ku_...","result":{"title":"Run result","summary":"Accepted result"}}
{"operation":"registerFolderScope","kuId":"ku_...","folder":{"path":"experiments/run-1"}}
{"operation":"linkKU","sourceKuId":"ku_...","targetKuId":"ku_...","link":{"relation":"contains"}}
{"operation":"buildScopedContext","query":"experiment 1 results","options":{"activeKuId":"ku_..."}}
```

## Output Format
Returns JSON text with `ok`, `result`, or `requiresDisambiguation`.

## Constraints
- Use natural-language resolution before asking users for KU ids.
- Unknown `ku_type` strings are allowed and must be preserved.
- Do not persist raw private prompts, hidden reasoning, credentials, secrets, tokens, or sensitive file content.
- Ambiguous high-impact updates must return `requiresDisambiguation` instead of mutating memory.
