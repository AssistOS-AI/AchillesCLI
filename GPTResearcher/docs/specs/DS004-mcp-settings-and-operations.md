---
title: DS004-mcp-settings-and-operations
summary: Defines GPTResearcher's MCP tools, settings interface, on-demand startup, and operational failure behavior.
---

## Introduction

GPTResearcher exposes one asynchronous research operation and three settings operations. These interfaces must remain stable for AchillesCLI delegation and the workspace settings panel.

## Core Content

| Tool | Contract |
| --- | --- |
| `start_research` | Accepts `query`, optional `context`, optional `reportType`, optional confined `workingDir`, and optional `useLocalDocs`; runs asynchronously and retains task output. |
| `gpt_researcher_get_settings` | Returns the normalized persistent non-secret settings object. |
| `gpt_researcher_update_settings` | Updates supported model, embedding, and search-provider fields while preserving valid omitted values. |
| `gpt_researcher_list_models` | Returns Soul Gateway model metadata and derives SearchAgent provider choices only from authorized catalog information. |

`start_research` must remain tagged as an internal agent-to-agent tool. Its shell launcher must execute the Python environment selected by the shared agent-home runtime-path helper, preserving standard input, arguments, and the Python exit status. AchillesCLI must start SearchAgent before GPTResearcher when necessary and submit the research through the router-mediated MCP path. The worker must remain `startup: manual` so unused research infrastructure does not join the normal startup graph.

The settings plugin must call the MCP settings tools rather than writing the settings file directly. The model list must come from Soul Gateway, and the search-provider list must be derived without bypassing SearchAgent or exposing its keys. A generated-local identity that cannot be certified must fail closed before key access or provider discovery.

The research task may run until completion or the configured AgentServer timeout. It must stream useful diagnostics to the retained log, cap returned log tails, and return a structured error when the upstream pipeline fails. Report filenames must be derived safely from time and query text and must remain inside the resolved working directory.
