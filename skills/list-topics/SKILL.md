---
name: list-topics
description: List the topics Promotion Scout monitors, with their search terms, tags and subtopics. Use before adding or deleting topics or subtopics, or when asked what Scout is watching.
---

# List Promotion Scout topics

## Description
Promotion Scout (the Ploinky agent `promotionScout`) monitors RSS/Atom feeds for saved topics and ranks posts against them. Each topic has search terms and tags used to build feeds (derived from the topic text unless set explicitly) and optional subtopics, the specific angles Scout compares discussions against. This skill lists every active topic. It changes nothing.

## Input Format
Run `node scripts/run.mjs` from this skill directory. `--input` is optional:

- omitted or empty: list every active topic;
- `<topic name>`: show only that topic (case-insensitive);
- JSON: `{"topic": "<topic name>", "format": "json"}`; both fields are optional, and `format: "json"` prints the raw topic records.

## Output Format
Plain text: the number of active topics, then for each topic its name, search terms, tags and subtopics. Each subtopic is shown as `[id] text`; `(derived)` marks terms or tags Scout derived from the topic text. Removed topics are not listed. Errors are printed on standard error with exit status 1.

## Constraints
- The skill calls the agent's `internal` MCP tools (`scout_agent_*`), which the Ploinky router admits only for agent callers, with the caller's identity. It needs a RoboTeam robot session (which provides `/workspace/ploinky-runtime`) or a Ploinky agent container (`/Agent/client`).
- The agent must be running; the router decides whether the caller may use it.
- Use the exact topic names printed here when calling the add-topic or delete-topic skills.

## Example
`node scripts/run.mjs --input "AI gaming news"` prints that topic's search terms, tags and subtopics.
