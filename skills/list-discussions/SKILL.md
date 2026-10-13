---
name: list-discussions
description: List the discussions Promotion Scout matched to a topic's subtopics (the Subtopic matches tab), each with its post, comments, matched subtopic and comments already stored. Use to pick discussions to write comments for.
---

# List Promotion Scout discussions

## Description
For posts that match a topic with subtopics, Promotion Scout (the Ploinky agent `promotionScout`) reads the post and its first comments and scores the discussion against that topic's subtopics. This skill lists those discussions as the Subtopic matches tab shows them, best matches first. Each discussion includes its title, link, post text, comments, the subtopic it matched with its similarity, and the comments already stored for it. It also shows the `item` and `project` identifiers the add-comments skill needs. It changes nothing.

## Input Format
Run `node scripts/run.mjs` from this skill directory. `--input` is optional:

- omitted or empty: matched discussions of every topic, 20 at a time;
- `<topic name>`: matched discussions of that topic only;
- JSON: `{"topic": "<topic name>", "show": "matched", "limit": 20, "offset": 0, "format": "text"}`, every field optional:
  - `show`: `matched` (a subtopic passed), `new` (matched for the first time and not yet reviewed) or `all` (also discussions with no passing subtopic);
  - `limit` (1 to 100) and `offset` page through the list;
  - `format: "json"` prints the raw records.

## Output Format
Plain text: the number of discussions, then one block per discussion with `item`, `project`, `topic`, `url`, the matched `subtopic` (`[new]` when it is new), the `post` (shortened to 2,000 characters), the numbered `comments` (each shortened to 800 characters) and the `stored comments`. A last line says how to get the next page when there is one. Errors are printed on standard error with exit status 1.

## Constraints
- The skill calls the agent's `internal` MCP tools (`scout_agent_*`), which the Ploinky router admits only for agent callers, with the caller's identity. It needs a RoboTeam robot session (which provides `/workspace/ploinky-runtime`) or a Ploinky agent container (`/Agent/client`).
- Only topics with subtopics have discussions; use list-topics to see them.
- Write a comment for the matched subtopic and the actual discussion; read the post and comments first. Skip discussions that already have a stored comment unless asked otherwise.

## Example
`node scripts/run.mjs --input '{"topic":"AI gaming news","show":"new","limit":5}'` lists up to five new discussions of that topic, ready for add-comments.
