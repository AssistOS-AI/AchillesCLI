# Specification Matrix

| Name | Description |
| --- | --- |
| [DS000-vision](specsLoader.html?spec=DS000-vision.md) | Defines saved topics and subtopics, a watched site catalog, operator-started monitoring run by a Ploinky agent, discussion reading, local relevance and human review boundaries. |
| [DS001-coding-style](specsLoader.html?spec=DS001-coding-style.md) | Defines module boundaries, dependency policy, test organization and documentation maintenance. |
| [DS002-architecture](specsLoader.html?spec=DS002-architecture.md) | Defines the agent's data directory, SQLite ownership and schema, sites, cached collection, run history, findings, persisted monitoring state, concurrent access and failure boundaries. |
| [DS003-main-behavior](specsLoader.html?spec=DS003-main-behavior.md) | Defines the Ploinky agent and its service lifetime, topics with search terms and tags, the watched site catalog, operator-started monitoring that survives restarts, visible ranking before and after the relevance filter, and discussions with subtopics. |
| [DS004-embeddings](specsLoader.html?spec=DS004-embeddings.md) | Defines replaceable model profiles, the default EmbeddingGemma model, offline inference, vector isolation, per-profile thresholds and relevance scores. |
| [DS005-providers](specsLoader.html?spec=DS005-providers.md) | Defines the site catalog, how topics become feed URLs, RSS/Atom collection, RSSHub use and polite request limits. |
| [DS006-lifecycle](specsLoader.html?spec=DS006-lifecycle.md) | Defines the agent's install step, the start of AgentServer and the agent daemon, RSSHub ownership, the lifecycle lock and shutdown with the container. |
| [DS007-web-interface](specsLoader.html?spec=DS007-web-interface.md) | Defines the user MCP tools for topics, sites, monitoring, results and discussions, their input and error contract, and the static browser interface with its tabs, polling and cycle log. |
| [DS008-discussions](specsLoader.html?spec=DS008-discussions.md) | Defines subtopics, reading the discussion behind each result, comparing post and first comments with subtopics, and the winning subtopic. |
| [DS009-agent-runtime](specsLoader.html?spec=DS009-agent-runtime.md) | Defines the promotionScout Ploinky agent: identity and manifest, router-mediated access, the persisted monitoring protocol between tools and the agent daemon, and monitoring cycles as asynchronous scout_run_cycle tasks. |
