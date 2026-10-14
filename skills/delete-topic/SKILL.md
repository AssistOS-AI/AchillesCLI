---
name: delete-topic
description: Remove a topic from Promotion Scout, or remove only some of a topic's subtopics. Use when asked to stop monitoring a subject or drop an angle.
---

# Delete a Promotion Scout topic or subtopics

## Description
Promotion Scout (the Ploinky agent `promotionScout`) monitors RSS/Atom feeds for saved topics; subtopics are the specific angles it scores discussions against. This skill either removes a whole topic or removes selected subtopics of one topic.

Removing a topic deactivates it: Scout stops collecting for it, but its history stays stored and adding the same topic again restores it. Removing a subtopic deletes it and its scores permanently.

## Input Format
Run `node scripts/run.mjs --input '<input>'` from this skill directory, where the input is either:

- a topic name, which removes the whole topic, for example `AI gaming news`;
- JSON `{"topic": "AI gaming news"}`, the same;
- JSON `{"topic": "AI gaming news", "subtopics": ["AI NPC dialogue", 7]}`, which removes only the listed subtopics, given by text (case-insensitive) or by the id that list-topics shows. The topic stays.

## Output Format
Plain text: the removed topic, or one line per removed subtopic. Errors are printed on standard error with exit status 1. When a listed subtopic does not exist, nothing is removed and the error lists the topic's subtopics.

## Constraints
- The skill calls the agent's `internal` MCP tools (`scout_agent_*`), which the Ploinky router admits only for agent callers, with the caller's identity. It needs a RoboTeam robot session (which provides `/workspace/ploinky-runtime`) or a Ploinky agent container (`/Agent/client`).
- Remove only what the user asked for. To drop one angle, pass `subtopics`; a bare topic name removes the whole topic.
- Topic names are case-insensitive. Run list-topics first when unsure of the exact name or subtopic ids.

## Example
`node scripts/run.mjs --input '{"topic":"AI gaming news","subtopics":["AI NPC dialogue"]}'` prints `Subtopic "AI NPC dialogue" [1] removed from "AI gaming news".`
