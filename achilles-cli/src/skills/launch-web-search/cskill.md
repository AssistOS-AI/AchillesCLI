# Launch Web Search

Placeholder launcher for future pure-information web search providers.

## Backend
web-search

## Cacheable
false

## ProviderAvailability
disabled

## Input Format
Accepts a JSON object or prompt text with a `prompt` field.

## Output Format
Returns a structured launcher result with `ok`, `backend`, `cacheable`,
`result_text`, `persistence_hint`, and `diagnostics`.

## Constraints
Do not perform web search directly. A real provider agent must be deployed
before this launcher can become active and cacheable.
Treat `@web-search` and `@search` as ordinary chat text, not dispatch tokens.
