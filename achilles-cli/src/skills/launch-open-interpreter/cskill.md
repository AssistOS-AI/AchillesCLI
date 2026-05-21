# Launch Open Interpreter

Dispatch an execution-oriented Copilot task to the Open Interpreter provider
through the Copilot Provider Relay.

## Backend
open-interpreter

## Cacheable
false

## RequiresInvocationToken
true

## ProviderAvailability
active

## Input Format
Accepts a JSON object or plain prompt text.

Fields:
- `prompt` (string): natural-language execution task.
- `workingDir` (string, optional): current working directory.
- `attachments`, `references`, `resources`, `paths` (arrays, optional): safe
  WebChat context supplied by AchillesCLI.
- `origin` (object, optional): generic surface metadata.
- `timeoutMs` (number, optional): provider task timeout.

When invoked by AchillesCLI WebChat, the invocation token and materialized
resources are read from the skill execution context.

## Output Format
Returns a structured object:

```json
{
  "ok": true,
  "backend": "open-interpreter",
  "cacheable": false,
  "result_text": "natural-language answer",
  "persistence_hint": {
    "ku_type": "code_work",
    "record_result": true,
    "ttl_hint_seconds": null
  },
  "diagnostics": {}
}
```

## Constraints
- Never call `openInterpreterAgent` directly.
- Always dispatch through `copilotProviderRelay.copilot_provider_task_submit`.
- Require the current router invocation token for delegated MCP.
- Treat `@open-interpreter` as ordinary chat text, not a dispatch token.
- Never serve Open Interpreter execution from AKU cache.
