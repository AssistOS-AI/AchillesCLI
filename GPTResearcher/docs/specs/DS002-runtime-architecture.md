---
title: DS002-runtime-architecture
summary: Defines GPTResearcher's process structure, provider routing, settings ownership, and report storage.
---

## Introduction

GPTResearcher runs the upstream GPT Researcher application behind a Ploinky AgentServer. The architecture must connect that application to local routing services without giving the browser, report, or research query direct access to provider credentials.

## Core Content

The manifest must pin the Bubblewrap runner image by digest. The selected image provides Node 24 and Python 3.12 on Debian Trixie, with a maintained Git/libcurl stack for the upstream application checkout. Native amd64 and arm64 publication gates must prove Git transport, sandbox confinement, and a real GPTResearcher cold installation before adoption.

| Component | Responsibility |
| --- | --- |
| Ploinky AgentServer | Exposes the asynchronous research tool and synchronous settings tools, retains task logs, and applies router authorization. |
| Research entry point | Validates input, resolves the working directory, applies settings, selects the source mode, and invokes the Python research pipeline. |
| Soul Gateway adapter | Sends language and embedding requests through the authenticated Ploinky route. |
| SearchAgent adapter | Sends generated web queries and the selected provider name to SearchAgent and normalizes returned results. |
| Settings store | Persists non-secret model aliases, embedding selection, and search-provider choice in the agent home. |
| Workspace writer | Creates the authorized working directory when allowed and writes a timestamped Markdown report without escaping `WORKSPACE_PATH`. |

The default profile must install the Python environment and upstream application before AgentServer starts. The nonzero container user must install both below its required absolute agent home: `$HOME/gpt-researcher/venv` and `$HOME/gpt-researcher/app`. Installation, UI startup, and the MCP research launcher must resolve these paths through the shared runtime-path helper; the image installation under `/opt` remains read-only. The startup script must launch the upstream GPT Researcher service and the Ploinky service expected by the manifest. Readiness must not succeed until the MCP surface is usable.

The research entry point must apply persisted settings before constructing the GPT Researcher instance. It must set `FAST_LLM`, `SMART_LLM`, `STRATEGIC_LLM`, `EMBEDDING`, `SEARCH_AGENT_PROVIDER`, and the SearchAgent retriever contract from normalized values. It must set `DOC_PATH` only for effective hybrid research and remove stale `DOC_PATH` state for web-only work.

The agent home and the workspace have separate ownership. The agent home stores configuration that should survive worker recreation. The workspace stores user documents and generated reports. Neither area may be treated as authority for the other.
