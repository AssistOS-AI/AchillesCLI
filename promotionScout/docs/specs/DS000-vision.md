---
title: DS000-vision
summary: Defines saved topics and subtopics, a watched site catalog, operator-started monitoring run by a Ploinky agent, discussion reading, local relevance and human review boundaries.
---

## Introduction

Promotion Scout helps a human operator find new public discussions relevant to saved interests and decide where to participate. It is delivered as the `promotionScout` [Ploinky agent](../wiki.html#definition-ploinky-agent) of the AchillesCLI repository.

## Core Content

The operator opens `/promotionScout/` on the Ploinky router and works in the [web interface](../wiki.html#definition-web-interface). There the operator saves [topics](../wiki.html#definition-topic) with their search terms and tags, reviews the [sites](../wiki.html#definition-site) Scout watches, chooses how often to search and starts [monitoring](../wiki.html#definition-monitoring). Each [run](../wiki.html#definition-run) reads the RSS/Atom feeds those sites produce for the topics, ranks the entries locally and stores the outcome. The interface shows what was collected before the relevance filter and which [results](../wiki.html#definition-result) passed it, with new results marked until the operator has seen them. For topics with [subtopics](../wiki.html#definition-subtopic), Scout also reads each result's [discussion](../wiki.html#definition-discussion), the post and its first comments, and shows which subtopic it is about. One SQLite database in the agent's [data directory](../wiki.html#definition-data-directory) preserves interests, monitoring state and history across agent restarts.

Every operation of the interface is an [MCP tool](../wiki.html#definition-mcp-tool) of the agent, reached through the router with the operator's session; the agent has no HTTP server of its own. Periodic execution belongs to the agent: its [agent daemon](../wiki.html#definition-agent-daemon) starts each due run as a [cycle task](../wiki.html#definition-cycle-task). The [agent runtime specification](DS009-agent-runtime.md) defines that contract.

Searching never starts on its own. Starting the agent prepares data and services but reads no feed; the operator's Start action begins periodic runs, which continue across agent restarts until the operator presses Stop.

The application must not post messages, write or generate replies, require OpenMagpie or PostgreSQL, or replace failed inference with keyword matching. Draft replies that earlier versions generated on the operator's request remain readable in the Subtopic matches tab as [generated comments](../wiki.html#definition-generated-comment); the agent never creates new ones. Only the agent's [install step](../wiki.html#definition-install-step) downloads model and service files. A missing model must fail runs visibly; an inference failure must fail its run without substitute scores.

Collection must use RSS/Atom feeds, read directly or through RSSHub routes, from a catalog of built-in and operator-added sites. Scout does not search the open web, so discussions on sites outside the catalog are not found. HTML may be inspected for feed links when a site is added; beyond that, only the discussion pages of results, or their public discussion APIs, are read, and only for topics with subtopics. Only English posts are ranked. Private groups, browser rendering, transcripts and complete historical coverage are excluded. Scout must not insist on a site that refuses requests. The product distributes a Ploinky agent with MCP tools, a static web interface and documentation; imported development instructions retain their own local documentation.
