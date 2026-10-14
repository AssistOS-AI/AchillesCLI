---
name: add-topic
description: Add a topic to Promotion Scout, optionally with subtopics, search terms and tags, or add subtopics to an existing topic. Use when asked to make Scout monitor a new subject or angle.
---

# Add a Promotion Scout topic

## Description
Promotion Scout (the Ploinky agent `promotionScout`) monitors RSS/Atom feeds for saved topics and ranks posts against the topic text. Subtopics are specific angles: for posts matching a topic, Scout reads the discussion and scores it against that topic's subtopics. This skill adds a topic (or restores a removed one) and then adds each subtopic. Run on an existing topic, it adds only the subtopics it does not have yet.

## Input Format
Run `node scripts/run.mjs --input '<input>'` from this skill directory, where the input is either:

- a topic name, for example `AI gaming news`;
- JSON: `{"topic": "AI gaming news", "subtopics": ["AI NPC dialogue", "procedural level generation"], "searchTerms": ["ai gaming"], "tags": ["gaming"]}`. Only `topic` is required.

Write the topic as a few words that state the combination you want, such as `AI in game development` rather than `AI`; Scout ranks posts against this text. Omit `searchTerms` and `tags` unless the user gives them: Scout derives them from the topic text. They take at most 5 entries each and apply only when the topic is created or restored.

## Output Format
Plain text, one line for the topic (`added`, `restored` or `already exists`) and one per subtopic (`added [id]` or `already exists`). If a subtopic is rejected, the lines so far, the error and the subtopics not added are printed on standard error with exit status 1; the topic and earlier subtopics stay saved.

## Constraints
- The skill calls the agent's `internal` MCP tools (`scout_agent_*`), which the Ploinky router admits only for agent callers, with the caller's identity. It needs a RoboTeam robot session (which provides `/workspace/ploinky-runtime`) or a Ploinky agent container (`/Agent/client`).
- A topic name has at most 200 characters; a subtopic at most 500, and a topic holds at most 200 subtopics.
- Topic names are case-insensitive: adding an existing name does not create a duplicate. Run list-topics first when unsure.
- Adding a topic does not start monitoring; the operator controls monitoring in the Scout page.

## Example
`node scripts/run.mjs --input '{"topic":"AI gaming news","subtopics":["AI NPC dialogue"]}'` prints `Topic "AI gaming news": added.` and `Subtopic "AI NPC dialogue": added [1].`
