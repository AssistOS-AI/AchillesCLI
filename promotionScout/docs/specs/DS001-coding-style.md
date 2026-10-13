---
title: DS001-coding-style
summary: Defines module boundaries, dependency policy, test organization and documentation maintenance.
---

## Introduction

The repository uses portable Node.js modules with explicit dependencies and tests of user-visible behavior.

## Core Content

### Runtime and source organization

Write executable application code as Node.js ECMAScript modules in `.mjs` files, with `node:` imports for built-ins and explicit extensions for local imports. Node.js 22.13 or newer supplies `node:sqlite`; the agent image provides Node.js 24. Prefer built-ins and `node --test`. Browser assets of the web interface and the documentation shell use `.js`; the start and install wrappers and the portable size checker use POSIX shell or Bash.

`manifest.json` and `mcp-config.json` declare the [Ploinky agent](../wiki.html#definition-ploinky-agent) and its tools. `scripts/` holds the [install step](../wiki.html#definition-install-step) (`install.sh`, `install.mjs`), the start script `startAgent.sh` and the real-model smoke check. `tools/` holds the tool entry points: `scout.mjs` for every synchronous [MCP tool](../wiki.html#definition-mcp-tool), `run-cycle.mjs` for the [cycle task](../wiki.html#definition-cycle-task). `src/agent/` owns the agent runtime: the per-call context (`context.mjs`), one operation per tool (`operations.mjs`), the cycle task (`cycle.mjs`) and the [agent daemon](../wiki.html#definition-agent-daemon) (`daemon.mjs`, `main.mjs`). Tool entry points stay thin: they parse the AgentServer payload and print one JSON value, and all behavior lives in `src/agent/operations.mjs` and the modules it calls.

`src/app/` owns paths, topics, the site catalog and feed selection, SQLite records, the persisted monitoring state (`control.mjs`), one run (`monitor.mjs`), read-only views, the install step (`bootstrap.mjs`, `install.mjs`), the npm presence check (`dependencies.mjs`) and service ownership (`services.mjs`, `processes.mjs`). `config/sites.json` declares the built-in sites. `web/` holds the static browser interface, written as plain HTML, CSS and JavaScript modules with no framework, build step or CDN; `agent.js` is its only route to the agent, through `/MCPBrowserClient.js` and the task-status endpoint. `src/providers/` owns HTTP requests, RSS/Atom parsing, feed resolution and discussion readers. Embedding inference remains behind `src/embeddings/index.mjs`; concrete runtimes must not leak into application workflows. Interface code follows the light/dark theme rules: every color is a token defined for both themes.

### Dependencies

Record dependency rationale in `dependencies.md`. Use `package.json` for npm dependency declarations with pinned versions; Ploinky prepares `node_modules` from it and the code reads that tree through `NODE_PATH`, and `package-lock.json` records the resolved versions for development. Do not generate a separate JSON dependency inventory. A dependency exception requires a concrete need, footprint, license and installation/update procedure. Do not install global tools implicitly. Only the install step downloads model files and builds native services; tools, cycle tasks and the daemon perform no installation.

### Verification

Run `npm test` after behavioral changes. `test/ide-plugin.test.mjs` verifies the Explorer toolbar plugin's declaration and its two ways of opening the page. `test/agent.test.mjs` verifies the MCP operations against a local fixture feed with a model double (topics, sites, monitoring start and stop, collection, results, discussions and their error objects), the tool entry's stdin/stdout protocol, the persisted monitoring control, the daemon's cycle scheduling, task following, cancellation and retry with a fake agent client, a cycle task aborted by Stop, topics too long for the model, and the consistency of `mcp-config.json`, the operations and the web interface's tool calls. `test/application.test.mjs` verifies source transactions, HTTP boundaries and the collected/result views with local fixtures; `test/embeddings.test.mjs` verifies model profiles, thresholds, isolation and failures; `test/topics.test.mjs` verifies topic fields, site templates and the built-in catalog, feed selection, request spacing, 403/429 pauses, refresh intervals, the English-only filter and cycle aborts; `test/lifecycle.test.mjs` verifies service ownership, the lifecycle lock, model preparation and the install step's dependency and prerequisite checks; `test/discussions.test.mjs` verifies subtopics, discussion adapters on fixed responses, the page-text fallback and a run that reads, scores and picks winning subtopics with caching and host pauses. Automated tests never contact the built-in sites; they disable them and use local fixtures. After inference or provider changes, explicitly download the default model if absent and run `node scripts/smoke-embeddings.mjs`. Mock tests do not establish model quality. Validate the agent declaration with the Ploinky agent validator after manifest or tool changes.

Run `bash fileSizesCheck.sh` to report file-size and code-line-length limits. Handwritten files above 500 lines require review and above 800 require splitting. Generated lockfiles and dependency inventories are exempt from splitting. Keep code lines near 120 characters; the checker highlights extreme lines above 1,000 characters. Keep prose paragraphs on logical source lines so browsers can wrap naturally.

### Documentation maintenance

Keep documentation, comments and specifications in English. Specifications are the source of truth; update both HTML documentation and relevant specifications when code changes. Keep numbering contiguous. Explain the operator's outcome before internal implementation. Use concrete commands and supported boundaries. Put rationale, limitations and assumptions directly in each specification's Core Content. Keep canonical project terminology on `docs/wiki.html` and link its stable anchors from eligible prose, excluding headings and literal code.

Before changing the main-behavior specification, analyze the actual tools, source, tests and architectural consequences and retain an evidence-backed accepted set. Imported skills keep their own documentation inside their folders; consumer-project documentation must not duplicate their specifications.
