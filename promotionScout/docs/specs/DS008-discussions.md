---
title: DS008-discussions
summary: Defines subtopics, reading the discussion behind each result, comparing post and first comments with subtopics, and the winning subtopic.
---

## Introduction

A topic finds relevant posts; [subtopics](../wiki.html#definition-subtopic) say which specific angle of that topic the operator cares about. For every result of a topic that has subtopics, Scout opens the [discussion](../wiki.html#definition-discussion), reads the post and its first comments, and tells which subtopic, if any, the discussion is about.

## Core Content

### Subtopics

A subtopic is free text attached to one topic, such as `AI-generated NPC dialogue in RPGs` under `AI gaming news`. A topic can hold any number of subtopics up to a safety limit of 200, each of 1 to 500 printable characters; equivalent spacing and capitalization do not duplicate one. The operator adds, changes and removes them in the topic's Edit dialog in the Topics tab; changing a subtopic's text replaces it with a new subtopic that is scored again, while unchanged subtopics keep their scores. Removing a subtopic deletes its scores. Subtopics do not change collection or topic ranking; they only drive discussion reading and scoring.

### Which discussions are read

After ranking and recording findings, a run reads discussions only when at least one topic has subtopics, and only for results whose best topic has subtopics. A result's best topic is the active topic with its highest score (ties go to the first label in alphabetical order); Collected and Topic matches keep listing every matching topic, but from this stage on the result belongs to its best topic alone. Collected entries below the threshold are never opened.

Each run reads every due discussion, in batches of 30 (`discussionDefaults.batchSize`). The reading order takes one result of each best topic in turn, newest first within a topic, so a topic with many results cannot keep the others waiting. After each batch the discussions just read are scored and their matches recorded, so they appear in the interface while the run continues, and a Stop keeps everything read and scored before it. The first run after subtopics are added may read hundreds of discussions; at one second per host, ten seconds for Reddit, it can last tens of minutes, and the next run starts only after it ends. A discussion whose host is paused after a 403 or 429 is deferred without using an attempt, because no request was made, and is read in the first run after the pause.

A failed read is retried after 24 hours, at most three times; its error stays visible. A discussion that was read is not read again, so comments posted afterwards are not seen.

The discussion address is taken from the feed entry: its RSS `<comments>` element when present, otherwise its `guid` or Atom `id` when that is an HTTP(S) URL, otherwise its link. This matters for link aggregators: Hacker News and Lobsters entries link to the article while their discussion lives elsewhere.

### How a discussion is read

Sites with a public structured source are read through it, which separates the post from its comments; every other page is read as text. Each adapter returns a title, the post text (at most 8,000 characters) and up to 10 top-level comments (at most 2,000 characters each) in the order the site shows them.

| Address | Source |
| --- | --- |
| `news.ycombinator.com/item?id=…` | Algolia Hacker News API `hn.algolia.com/api/v1/items/{id}` |
| `lobste.rs/s/{id}` | `lobste.rs/s/{id}.json`, top-level comments |
| `reddit.com/r/…/comments/{id}` | `reddit.com/comments/{id}.json?depth=1&sort=top` |
| Stack Exchange question (`stackoverflow.com`, `*.stackexchange.com`, `superuser.com`, `serverfault.com`, `askubuntu.com`, `mathoverflow.net`) | the question's Atom feed; the question, then answers by votes |
| `…/post/{id}` (Lemmy) | `/api/v3/post` and `/api/v3/comment/list?max_depth=1&sort=Top` |
| `…/@user/{id}` (Mastodon-compatible) | `/api/v1/statuses/{id}` and its `/context`, direct replies only |
| `bsky.app/profile/{handle}/post/{rkey}` | public AppView: handle resolution and `getPostThread?depth=1` |
| `dev.to/{user}/{slug}` | DEV articles and comments API |
| `…/t/{slug}/{id}` (Discourse) | `/t/{id}.json`, opening post then replies |
| any other page | page text: scripts, styles and page chrome removed, `<article>` or `<main>` preferred; when the body has under 200 characters, the page description leads |

Lemmy, Mastodon and Discourse are recognized only by URL shape, so a page that merely looks like one is read as text when the API answers with an error. A 403 or 429 never triggers that fallback. Generic page text cannot separate comments, so it contains them inline along with any remaining page chrome. Pages rendered by JavaScript yield little more than their description. MetaFilter serves RSS but refuses its HTML pages with 403, so its discussions cannot be read.

Discussion reads use the same per-host discipline as feeds: at least one second between requests to a host, no retry of 429, and a six-hour pause of the host after a 403 or 429, stored in SQLite. Every request an adapter makes passes through this gate, including the second API call of a two-step read. Unlike feed polls, discussion reads follow HTTP redirects, because article and page URLs often move.

### Why ten comments

The compared text must fit the model's 2,048-token window to be scored as one passage. On ten real Hacker News and Lobsters discussions with 1,556 top-level comments, a comment had a median of 47 tokens and a 90th percentile of 141. The post plus its first 10 comments had a median of 599 tokens and a maximum of 1,401, so every case fitted; with 30 comments two of ten exceeded the window. Because an embedding summarizes the whole text, many comments would also outweigh the post. Ten comments keep the post prominent, fit the window and keep inference short. The value is `threadDefaults.comments` in `src/providers/threads.mjs`.

### Scoring and the winning subtopic

Subtopic scoring builds on the topic matching of step 3 and never revisits it. A discussion is compared only with the subtopics of its result's best topic, and subtopics of other topics are never scored against it. When the best topic has no subtopics, the discussion is not read, even if a weaker matching topic has subtopics.

The compared text is the discussion title, the post and its first 10 comments, joined by line breaks. Each subtopic is embedded as a query and the text as a document with the active model; a text longer than the window is split into passages and the best passage counts. A subtopic matches when its score reaches the active profile's subtopic threshold, `subtopicThreshold` (0.35 for EmbeddingGemma), which is separate from the topic threshold; a profile without one reuses its topic threshold.

The default 0.35 is provisional. On 94 discussion/subtopic pairs from one live collection (47 discussions, four subtopics of two topics), every pair was reviewed by hand and none was about its subtopic; their scores ranged from 0.04 to 0.34, so the topic threshold 0.25 would have shown six irrelevant matches, while 0.35 rejects all of them. The real-model check scores a fitting subtopic at 0.58 and an unrelated one at 0.04. Discussion text is longer and mixes the post with many comments, so a relevant discussion can score lower than a relevant feed entry. No relevant real discussion was available, so recall is unmeasured: the value must be recalibrated, comparing precision and recall across thresholds as for topics, once labeled relevant discussions exist.

When several subtopics of the topic match, the one with the highest score wins; when none matches, the discussion is shown as read without a match. Scores are cached by item, subtopic, embedding namespace and discussion content hash, so adding a subtopic scores only that subtopic at the next run, and a model change rescores everything.

Inference failures stop the run as for topic ranking. A discussion that cannot be read is not a run failure: it is reported in the log, counted in the run statistics and shown with its error.

### Display

The Subtopic matches tab, step 4 of the pipeline, lists one card per read discussion, under its best topic, matched ones first by winning score. Each card shows the delivering site, the discussion link, its topic, the winning subtopic and its score, every subtopic's score, the source used to read it, and an expandable view of the post and its comments. The Matched / New only / All read switch narrows the list to new matches or also reveals discussions without a match and those that could not be read. The expandable view ends with any [generated comments](../wiki.html#definition-generated-comment) stored for the discussion within its topic, written by other agents through `scout_agent_comments_add` or by earlier versions, read-only; they never affect reading, scoring or match records, and Scout generates none itself.

A subtopic match is recorded once per discussion and topic, in the run that first finds a matching subtopic, and is new until the operator marks it reviewed with its button or with Mark all reviewed; the tab label counts new matches. Opening the discussion link does not change the mark, since the operator reads a discussion before deciding about it. A match that stopped after subtopic or topic changes and returns is not new again. The count line reports how many results are still waiting to be read. Run statistics record discussions read, failed, deferred and scored, how many matched a subtopic and how many matches were new.
