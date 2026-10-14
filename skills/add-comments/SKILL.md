---
name: add-comments
description: Store a batch of comments you wrote for Promotion Scout discussions so they appear with each discussion in Scout's Subtopic matches tab. Use after list-discussions, once the comments are written.
---

# Store comments in Promotion Scout

## Description
Promotion Scout (the Ploinky agent `promotionScout`) shows each discussion of its Subtopic matches tab with its post, its comments and the comments stored for it. Scout writes no comments itself. This skill stores the comments you wrote as one batch, in one database transaction: either every comment is stored or none is. Each comment belongs to one discussion and one of its topic's subtopics. The operator sees it in the discussion's expandable section with the agent name, model, subtopic and time. Nothing is posted anywhere.

## Input Format
Run `node scripts/run.mjs --input '<JSON>'` from this skill directory with:

```json
{"agent": "<your name>", "model": "<model>", "comments": [
  {"item": "<item>", "project": "<project>", "comment": "<text>", "subtopic": "<subtopic>"}
]}
```

- `comments` holds 1 to 100 entries; split larger sets into several batches.
- Each entry requires `item`, `project` and `comment`. Copy `item` and `project` exactly from list-discussions.
- `subtopic` is optional and must be one of the topic's subtopics (case-insensitive); without it, the comment is filed under the discussion's best-scoring subtopic.
- The shared `agent` (your robot or agent name) and `model` (the model that wrote the comments) apply to entries that do not set their own; without `agent`, Scout records `agent`.
- A single comment object without `comments` is accepted as a batch of one.

## Output Format
Plain text: `Stored N comments:` and one line per comment with its id, item, topic, subtopic and author. If any entry is rejected, nothing is stored, and standard error shows `No comment was stored:` with the code and the failing entry, for example `DISCUSSION_UNKNOWN: comments[2]: …` or `SUBTOPIC_UNKNOWN: …`, with exit status 1. Fix or drop that entry and send the batch again.

## Constraints
- The skill calls the agent's `internal` MCP tools (`scout_agent_*`), which the Ploinky router admits only for agent callers, with the caller's identity. It needs a RoboTeam robot session (which provides `/workspace/ploinky-runtime`) or a Ploinky agent container (`/Agent/client`).
- A comment has at most 10,000 characters and may span several lines. It is stored as given; storing the same text again adds a second comment.
- Each discussion must still belong to an active topic and have been read without error.
- Write each comment for its discussion and subtopic; read them with list-discussions first.

## Example
`node scripts/run.mjs --input '{"agent":"robot-writer","model":"claude-opus-5-5","comments":[{"item":"3f2a…","project":"9c1d…","comment":"Great point about NPC memory…"}]}'` prints `Stored 1 comment:` and `- [12] item 3f2a… (topic "AI gaming news", subtopic "AI NPC dialogue", by robot-writer/claude-opus-5-5)`.
