---
title: DS007-web-interface
summary: Defines the user MCP tools for topics, sites, monitoring, results and discussions, their input and error contract, and the static browser interface with its tabs, polling and cycle log.
---

## Introduction

The [web interface](../wiki.html#definition-web-interface) is how the operator manages topics and the watched sites, starts and stops monitoring and inspects what each run collected and selected. It is a set of static pages that perform every operation as a user [MCP tool](../wiki.html#definition-mcp-tool) of the agent, called through the Ploinky router with the operator's session. The same tools serve any other authenticated MCP client.

## Core Content

### Access and protection

The Ploinky router owns authentication and authorization. The pages under `/promotionScout/` and the endpoint `/promotionScout/mcp` require a signed-in workspace user; Scout performs no login, host or origin check of its own and runs no HTTP server. The router supplies the browser's CSRF protection for tool calls. User tools carry no tags in `mcp-config.json`, so router policy admits any authenticated user and denies guests; a persisted router policy may narrow that. The internal cycle tool is defined by the [agent runtime specification](DS009-agent-runtime.md).

The browser code inserts all tool data as text, never as HTML, and opens only `http` and `https` result links, in a new tab without a referrer.

### Tool contract

Every user tool runs `node tools/scout.mjs <operation>` with `/code` as working directory and a 60-second timeout, 120 seconds for `scout_site_add`, which may fetch the added address. The process reads the AgentServer payload `{tool, input, metadata}` as one JSON line from standard input, opens the SQLite database in the [data directory](../wiki.html#definition-data-directory), runs the operation from `src/agent/operations.mjs` and prints one JSON value on standard output. Input schemas list every accepted field and reject unknown ones. An expected failure, an error with a code such as `INPUT_INVALID`, `TOPIC_UNKNOWN`, `TOPIC_EXISTS`, `SITE_UNKNOWN`, `SITE_EXISTS`, `SITE_BUILTIN`, `SUBTOPIC_UNKNOWN`, `FEED_NOT_FOUND`, `MONITOR_RUNNING` or `MONITOR_STOPPING`, is printed as `{"error": {"code", "message"}}` with exit status 0; an unknown operation gives `USAGE`. Only an unexpected failure exits nonzero, which AgentServer reports as an MCP error. Tools never take the lifecycle lock, download files or start services.

Every listing is paged: it accepts `offset` and `limit` (1 to 500) and returns `{ total, offset, limit, items }`. Default page sizes follow the expected list lengths: topics 20, sites 20, results 25 (tall cards), discussions 25, collected entries 50, sources 50 and runs 24 (one day of hourly runs). `topic` is a topic's internal project identifier and limits a listing to that topic; `sites` is an array of site identifiers.

| Tool | Contract |
| --- | --- |
| `scout_status` | Monitoring flag, interval and offered `intervalChoices`, `cycleRunning`, `currentRun`, `currentTaskId`, `lastTaskId`, `lastRunId`, next run time, the daemon heartbeat with its service states, the last run with statistics and errors, topic-field and tag-style limits, topic and subtopic thresholds, model name, page sizes, data directory and RSSHub address and health. |
| `scout_monitor_start` | Input `intervalHours`, one of 1, 2, 4, 6, 8, 12, 24, 48 or 168. Saves the interval and turns monitoring on so the first cycle is due at once; `MONITOR_RUNNING` when already on, `MONITOR_STOPPING` while a run or cycle task is still recorded. Returns the status fields. |
| `scout_monitor_stop` | Turns monitoring off; the running cycle aborts by itself and RSSHub keeps running. Returns the status fields. |
| `scout_topics_list` | Active topics with their subtopics, text, stored search terms and tags, the effective (stored or derived) lists with flags marking derived ones, and the number of feeds they currently use. |
| `scout_topic_derive` | Input `label`. The search terms and tags Scout would derive from that text; read-only, used to preview them in the form. |
| `scout_topic_create` | Input `label`, optional `searchTerms` and `tags`, at most 5 entries of at most 100 (terms) or 50 (tags) characters. Adds or restores a topic and returns `added`, `restored` or `already exists`; an existing active topic keeps its fields. |
| `scout_topic_update` | Input `key` and optional `label`, `searchTerms`, `tags` and `subtopics` (`[{id?, text}]`), applied in one transaction. A new `label` renames the topic in place (`TOPIC_EXISTS` when another topic, active or removed, has that text). A subtopic sent with its id and unchanged text keeps its id and scores; a changed text becomes a new subtopic; omitted subtopics are deleted; empty and duplicate texts are ignored. |
| `scout_topic_delete` | Input `key`. Deactivates the topic whose normalized key or label matches; `TOPIC_UNKNOWN` otherwise. |
| `scout_subtopic_add` | Input `topic` (topic key) and `text`. Returns `added` with its id or `already exists`. |
| `scout_subtopic_remove` | Input `id`. Removes a subtopic and its scores; `SUBTOPIC_UNKNOWN` when unknown. |
| `scout_sites_list` | Every site with kind, address template, tag style, built-in and enabled flags, feeds currently produced, entries collected, last poll and failing feed count. |
| `scout_site_add` | Input `name`, `kind` (`search`, `tag` or `feed`), `template` and optional `tagStyle`. Adds an operator site after validating the template; a feed address is resolved to its RSS/Atom URL first. |
| `scout_site_set_enabled` | Input `id` and `enabled`. Enables or disables any site. |
| `scout_site_delete` | Input `id`. Deletes an operator site; `SITE_BUILTIN` for a built-in site. |
| `scout_sources_list` | Concrete feeds linked to active topics with site, type, address, last attempt, entry count, error or skip reason, and whether the topic's current terms, tags and sites still produce them. |
| `scout_items_list` | Collected feed entries before the threshold, newest first, each with its best current score, status, new mark and delivering sites; `sites` keeps entries delivered by any listed site. Adds `all`, the count without the site filter, and `facets`, one `{ id, name, count }` per site. |
| `scout_results_list` | Every URL that passed the threshold for an active topic, with its delivering sites. `sort` is `new` (default: new first, then score), `found` or `score`; `new: true` lists only new results; `sites` filters by site. Adds `newCount`, the unfiltered `all` count and `facets` computed after the topic and new filters but before the site filter. |
| `scout_results_mark_seen` | Optional `urls`; marks those results reviewed, or all of them when omitted, and returns the number marked. |
| `scout_discussions_list` | One entry per read discussion and active topic it matched, for topics with subtopics: thread address, source, title, post, comments, sites, `topic` and `project`, each subtopic's score and pass flag, the winning subtopic, `new`, `run`, `found_at` and `generations`, the finished [generated comments](../wiki.html#definition-generated-comment) of earlier versions for that topic (id, comment, agent, model, subtopic, finish time). `show` is `matched` (default), `new` or `all`; adds `matched`, `newCount`, `all` and `pending` (results not read yet). |
| `scout_discussions_mark_seen` | Optional `matches` (`[{item, topic}]`); marks those subtopic matches reviewed, or all of them when omitted, and returns the number marked. |
| `scout_runs_list` | Runs, newest first, with status, counts and errors. |

Scores in item and result listings are read only for the current [embedding namespace](../wiki.html#definition-namespace) and each topic's current intent, so a model or intent change shows entries as not evaluated until a new run ranks them. Listing and status tools never change collection or ranking state.

### Pages and their route to the agent

The pages live in the agent's `web/` directory and are served by the router at `/promotionScout/web/`; the agent root `index.html` redirects `/promotionScout` and `/promotionScout/` there, keeping the fragment. `web/agent.js` derives the agent route from the first path segment, creates the client with `createAgentClient('/<route>/mcp')` from the router's `/MCPBrowserClient.js`, drops empty arguments, takes the first non-`stderr` text content of a result, parses it as JSON and turns an `error` object into a thrown error with its code. It reads a cycle task with a credentialed `GET /<route>/task?taskId=…`; a 404 means the task is no longer known.

Explorer discovers the toolbar plugin `IDE-plugins/scout-tool-button/` in the agent's source. Its **Scout** button opens `/promotionScout/web/` in an iframe of Explorer's full-screen expanded modal, whose `agentRef` `AchillesCLI/promotionScout` lets Explorer wait for the agent to become ready. Without that host modal, it opens Explorer's runtime loader (`/explorer/index.html#agent-runtime-wait`) in a new tab with the same page as its target. The page is same-origin with Explorer, so it uses the signed-in session; the plugin carries no credentials and calls no tools.

### Monitoring state and the cycle log

The page loads the status once at start and then polls `scout_status` every two seconds while a cycle runs and every five seconds otherwise. It refreshes its data when `lastRunId` changes; because run identifiers only grow, a delayed response cannot hide a finished run. A failed poll shows `Disconnected` and the error, and polling continues. The Monitor tab shows the agent daemon as running while its heartbeat is less than 30 seconds old and as not responding otherwise, and RSSHub with its health, address and the daemon's last error for it.

The cycle log shows the `logTail` of the current cycle task, or of the last one when no cycle runs, and follows its end while the reader is at the bottom. When the task is no longer known, for example after an AgentServer restart, the log says so; the Runs tab keeps the run's record. Each new `Discussions batch` line reloads the Subtopic matches list so matches appear while the run continues.

### Browser interface

The page has eight tabs on one surface, with no stacked dialogs, ordered as the work flows: three setup tabs, Topics, Sites and Monitor; four numbered pipeline tabs, 1 Feeds, 2 Collected, 3 Topic matches and 4 Subtopic matches, each a later step than the one before; then Runs, separated by thin dividers. On narrow screens the tab bar scrolls sideways and keeps the selected tab visible.

The tabs contain: Monitor (interval selector, Start/Stop button, next run time, agent daemon and RSSHub state, last run summary and cycle log), Topics (add form with the topic and optional search terms and tags that preview their derived values while typing, a topic table with chips marking derived values as `auto`, a large Edit dialog holding the editable topic text, search terms, tags and an editable subtopic list (Save is the only submit button, so Enter saves), a read-only subtopic list under each topic with an Edit subtopics link, and a small confirmation before removal) and Sites (the catalog table with enable/disable and delete actions, and an add form whose tag-style field appears for tag sites).

The result tabs contain: Topic matches (topic filter, only-new filter, mark-all-reviewed action and result cards with score, topics, run, passage and a Mark reviewed button while new), Subtopic matches (topic filter, Matched / New only / All read switch, mark-all-reviewed action, cards with a new mark and a Mark reviewed button while new, the winning subtopic, every subtopic's score and an expandable post with its comments followed by any generated comments of earlier versions), Collected (paged table of all collected entries with score and status), Feeds (each concrete feed with site, topic and outcome) and Runs (one row per run with counts and expandable errors). The interface offers no action that writes or requests a reply.

Topic matches and Collected show one chip per site with its count, plus All; several chips can be combined, and more than ten sites collapse into a single dropdown. Topic matches also offer an All / New only switch and a sort selector. Each card shows the delivering site as a badge before the title and the link's host in its details, so a Hacker News post linking to an article is still identified as Hacker News. The site, show and sort choices are kept in the URL fragment (for example `#topic-matches?site=bluesky&show=new&sort=score`) and survive a reload.

Each list shows a pager (previous, page number, range and next) when it has more than one page; changing the topic, site, show or sort filter returns to the first page. The Topic matches and Subtopic matches tab labels show how many of their entries are new. Opening a topic match marks it reviewed; opening a subtopic match does not, so only its button or the mark-all action clears its new mark. The selected tab is kept in the URL fragment as `#topics`, `#sites`, `#monitor`, `#feeds`, `#collected`, `#topic-matches`, `#subtopic-matches` or `#runs`; the earlier fragments `#sources`, `#results` and `#discussions` still open the same tabs and are rewritten to the new names, and an unknown fragment opens Monitor.

The interface follows the system light or dark preference, and the operator can force either theme; that choice is stored only in the browser. Both themes define the same surfaces, borders, status colors and badges.
