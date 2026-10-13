# Promotion Scout

Promotion Scout finds new public discussions relevant to topics you save. It runs as the Ploinky agent `promotionScout` of the AchillesCLI repository: open its web page through the Ploinky router, add topics with search terms and tags, and start monitoring. Scout then reads the feeds of a catalog of sites at the interval you choose, from every hour to once a week, and shows relevant posts with similarity scores and original passages, marking the new ones.

A catalog of sites (Reddit, Hacker News, Ask HN, Bluesky, Mastodon, Lemmy, DEV Community, Medium, Lobsters, Stack Overflow, MetaFilter, Ask MetaFilter, Tildes, Product Hunt, Slashdot, Hugging Face daily papers, plus any you add) supplies RSS/Atom feeds, directly or through a local RSSHub. A local multilingual embedding model ranks the entries, and one SQLite database keeps topics, sites, entries, vectors, runs and result history. Scout does not search the rest of the web, runs no generative LLM, posts nothing and uses no additional database. Scout writes no comments itself: RoboTeam robots can read its discussions and store comments they wrote, which appear with each discussion, together with comments from earlier versions.

## Run the agent

Enable and start the agent from the Ploinky workspace that has the AchillesCLI repository installed (agent id `agent:AchillesCLI/promotionScout`):

```sh
ploinky enable agent AchillesCLI/promotionScout
ploinky start
```

Before every start, the agent's install step (`scripts/install.sh`) prepares the data directory: configuration, SQLite, the default embedding model and a pinned native RSSHub. Ploinky installs the npm dependencies from `package.json`. The first start downloads about 309 MB of model files and builds RSSHub, which can take several minutes; later starts reuse every completed step. A failed step stops the start with an explicit error and keeps the completed ones. The install step's output and exit status are also kept in `.data/promotionScout/runtime/install.log`, because Ploinky removes a failed container with its log.

Then open `/promotionScout/` on the Ploinky router (for example `http://127.0.0.1:8080/promotionScout/`) and sign in. The page redirects to `/promotionScout/web/`. In Explorer, the **Scout** button in the file explorer toolbar opens the same page in a full-screen panel, waiting for the agent to start if needed. The router authenticates every request; the agent opens no port of its own.

## Using the web interface

The first three tabs set Scout up:

- **Topics**: add a topic of a few words, such as `AI gaming news`. Search terms (for search sites) and tags (for tag sites) are derived automatically (`ai gaming`; `ai gaming`, `ai`, `gaming`) and shown while you type; you can replace them with up to five of your own. The model ranks against the topic text. Edit changes the topic text, terms, tags and subtopics; Remove deactivates a topic and keeps its history.
- **Sites**: the built-in catalog with what each site produced. Disable sites you do not want, or add a feed URL, a page with a feed, a search or tag address with `{query}`/`{tag}`, or an RSSHub route.
- **Monitor**: choose how often to search (every 1, 2, 4, 6, 8 or 12 hours, once a day, every two days or once a week) and press **Start monitoring**. The first cycle starts immediately; the button becomes **Stop**. Monitoring continues across agent restarts until you press Stop. Stop aborts a running cycle and keeps its run record; RSSHub keeps running. The page shows the agent daemon and RSSHub health, the last run and the cycle log, which follows a running cycle live and keeps showing the last one.

The numbered tabs follow a post through the pipeline, in order:

1. **Feeds**: every concrete feed built from a topic and a site, with its last attempt and outcome.
2. **Collected**: every feed entry stored in SQLite before the relevance filter, with its site, score and whether it passed; site chips with counts filter it.
3. **Topic matches**: every URL whose similarity reached the model's threshold (0.25) for an active topic, with its site, matching topics and the best original passage. New matches are marked until you open them, press **Mark reviewed** on one or **Mark all reviewed**. Filter by topic, by site and All / New only, and sort by new first, newest found or score.
4. **Subtopic matches**: in a topic's Edit dialog, add subtopics (specific angles, as many as you need). For topic matches of such topics, Scout reads the post and its first 10 comments and this tab shows which of that topic's subtopics each discussion is about, with each subtopic's score. A post belongs to its best topic, and only that topic's subtopics are compared; a subtopic matches at 0.35, a stricter threshold than the 0.25 used for topics. A discussion that matches a subtopic for the first time is marked new until you mark it reviewed. The expandable section shows the post, its comments and the comments stored for it (written by RoboTeam robots through the add-comments skill, or by earlier versions), each with its agent, model, subtopic and time.

The last tab, **Runs**, lists each cycle's duration, counts and errors.

Each feed is read at most once per hour, which is why the shortest interval is one hour. Requests to one site are spaced (ten seconds for Reddit), a 429 is never retried, and a site answering 403 or 429 is paused for six hours. Scout stores feed validators, content and embeddings to avoid repeated transfers and inference. The default selection ranks English posts from the last seven days with the pinned EmbeddingGemma 300M model and a similarity threshold of 0.25. A score measures similarity, not the probability that a discussion is a good place to post, and it is not a percentage: with EmbeddingGemma unrelated texts score near 0 and relevant ones usually 0.3 to 0.65 (see [Understand the scores](docs/operator.html)).

Non-English posts are detected locally and set aside; short titles are always kept. Most remaining mistakes match only part of a topic (an AI post for "AI in gaming"), so write descriptions that state the combination. Unknown tags are reported as skips. Network errors and malformed feeds make a cycle partial while keeping its other results. A model failure fails the cycle; Scout never substitutes keyword scores.

## Skills for robots

The `skills/` folder holds five self-contained skills that RoboTeam robots (or any Ploinky agent) use: `list-topics`, `add-topic` and `delete-topic` manage topics and subtopics; `list-discussions` returns the Subtopic matches discussions with their posts and comments so a robot can write comments, and `add-comments` stores those comments so they appear in the tab. Each has a `SKILL.md` and runs as `node scripts/run.mjs --input '<topic or JSON>'`, for example:

```sh
node skills/add-topic/scripts/run.mjs --input '{"topic":"AI gaming news","subtopics":["AI NPC dialogue"]}'
```

The skills call the `scout_agent_*` tools through the Ploinky router with the caller's identity, using the Ploinky client that RoboTeam mounts in each robot session (or `/Agent/client` inside an agent container). After adding tools to `mcp-config.json`, run `ploinky start` so the router records their access.

## How the agent works

- **AgentServer** (Ploinky's bundled runtime) serves the static web interface and the MCP tools in `mcp-config.json`. Every operation of the page is a tool such as `scout_topics_list` or `scout_monitor_start`, run as `node tools/scout.mjs <operation>` against SQLite. These tools carry no tags, so any authenticated user may call them. Seven `internal` tools (`scout_agent_*`) let other agents manage topics, read discussions and store comments.
- **The daemon** (`src/agent/main.mjs`), started beside AgentServer by `scripts/startAgent.sh`, keeps RSSHub running and starts each due cycle by calling the agent's own internal tool `scout_run_cycle` through the router.
- **A cycle** is one asynchronous Ploinky task. It loads the embedding model only for its own duration, writes its progress to the task log that the page displays and records its run in SQLite.

The monitoring choice (on or off, the interval and the last start) is stored in SQLite, which is how monitoring resumes after a restart. See the [architecture](docs/architecture.html) and the [specifications](docs/specs/matrix.md).

## Data and services

All data lives in the agent's volume, `.data/promotionScout/` in the Ploinky workspace (`/data` inside the container): `scout.sqlite`, the only application database, plus `config.json`, `models/`, `services/` (the RSSHub checkout and its build tools) and `runtime/` (the lifecycle lock and RSSHub logs). Outside Ploinky, `SCOUT_DATA_DIR` selects the directory, with `~/.local/share/promotion-scout/` as the fallback.

The database schema has no migrations. If Scout reports `DB_VERSION` for a database written by an earlier version, stop the agent and remove `scout.sqlite` with its `-wal` and `-shm` files; topics then need to be added again.

RSSHub listens on `http://127.0.0.1:1200` inside the agent container and is never exposed. Its log is `runtime/rsshub.log`. No API keys are needed. Scout reads RSS 2.0, RSS 1.0 and Atom; HTML is fetched only to find a feed link when you add a web page as a site, and for discussion pages of topics with subtopics. See [sites and feeds](docs/providers.html).

The model is EmbeddingGemma 300M (`onnx-community/embeddinggemma-300m-ONNX`) with q8 weights, 768-dimensional vectors and a 2048-token input limit, distributed under the Gemma Terms of Use. It needs about 309 MB on disk and about 1.6 GB of memory while a cycle ranks posts. Transformers.js 4.3.1 runs it through ONNX Runtime on CPU in a worker thread of the cycle task, which releases it when the cycle ends. Dependencies, licenses and requirements are listed in [dependencies.md](dependencies.md).

## Documentation and verification

Serve the documentation with `node scripts/serve-docs.mjs` (port 4173) and read the [operator guide](docs/operator.html), [architecture](docs/architecture.html), [terminology](docs/wiki.html) and [specifications](docs/specs/matrix.md).

```sh
npm test
node scripts/smoke-embeddings.mjs
bash fileSizesCheck.sh
node ../.agents/skills/manage-ploinky-agents/scripts/validate-ploinky-agent.mjs --agent-dir .
```

Unit tests use local fixtures and model doubles: they cover the MCP operations, the tool entry, persisted monitoring control, the daemon's task handling and cycle aborts, not model quality. `smoke-embeddings.mjs` exercises real offline inference and needs a downloaded model in the data directory. The validator checks the manifest and MCP configuration.
