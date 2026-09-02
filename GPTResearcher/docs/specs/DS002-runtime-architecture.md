---
title: DS002-runtime-architecture
summary: Defines GPTResearcher's process structure, provider routing, settings ownership, and report storage.
---

## Introduction

GPTResearcher runs the upstream GPT Researcher application behind a Ploinky AgentServer. The architecture must connect that application to local routing services without giving the browser, report, or research query direct access to provider credentials.

## Core Content

The manifest must pin the Bubblewrap runner image by digest. The selected image provides Node 24 and Python 3.12 on Debian Trixie, with a maintained Git/libcurl stack for the upstream application checkout. Native amd64 and arm64 publication gates must prove Git transport, sandbox confinement, and a real GPTResearcher cold installation before adoption.

The adopted index is `sha256:9b6c08cf78fd0a29acfbe2e45ea2ee26efe6fde49c7f3db8b3aadfa30f2d53f8`, published by [native build 33662621018](https://github.com/AssistOS-AI/container-image-builds/actions/runs/33662621018). Both architectures passed all 14 Git/npm transport operations, sandbox confinement, and GPTResearcher's cold installation, source-provenance, networkless UI/readiness, and input-path checks.

| Component | Responsibility |
| --- | --- |
| Ploinky AgentServer | Exposes the asynchronous research tool and synchronous settings tools, retains task logs, and applies router authorization. |
| Research entry point | Validates input, resolves the working directory, applies settings, selects the source mode, and invokes the Python research pipeline. |
| Soul Gateway adapter | Sends language and embedding requests through the authenticated Ploinky route. |
| SearchAgent adapter | Sends generated web queries and the selected provider name to SearchAgent and normalizes returned results. |
| Settings store | Persists non-secret model aliases, embedding selection, and search-provider choice in the agent home. |
| Workspace writer | Creates the authorized working directory when allowed and writes a timestamped Markdown report without escaping `WORKSPACE_PATH`. |

The default profile must install the Python environment and upstream application before AgentServer starts. The nonzero container user must install both below its required absolute agent home: `$HOME/gpt-researcher/venv` and `$HOME/gpt-researcher/app`. Installation, UI startup, and the MCP research launcher must resolve these paths through the shared runtime-path helper; the image installation under `/opt` remains read-only. The startup script must launch the upstream GPT Researcher service and the Ploinky service expected by the manifest. Readiness must not succeed until the MCP surface is usable.

Cold installation must clone the upstream default branch once, install its requirements, and install the `gpt-researcher` Python distribution from that same application checkout using the normal package build. It must not independently install the PyPI release, patch installed package files, or select an older release to work around an import failure. Reinstallation must replace a stale separately installed distribution with the selected checkout package. The UI and MCP adapter must therefore use the same upstream source revision even when upstream package version metadata differs from the latest PyPI version. Native import and provider smoke gates must remain enabled and record the actual checkout and installed package provenance.

The research entry point must apply persisted settings before constructing the GPT Researcher instance. It must set `FAST_LLM`, `SMART_LLM`, `STRATEGIC_LLM`, `EMBEDDING`, `SEARCH_AGENT_PROVIDER`, and the SearchAgent retriever contract from normalized values. It must set `DOC_PATH` only for effective hybrid research and remove stale `DOC_PATH` state for web-only work.

The agent home and the workspace have separate ownership. The agent home stores configuration that should survive worker recreation. The workspace stores user documents and generated reports. Neither area may be treated as authority for the other.

## Decisions

### Decision #1: Keep UI and MCP code on the same upstream revision

The separate PyPI `gpt-researcher` 0.16.0 installation failed during import because a type annotation preceded its `Any` import. The current upstream default branch contains the correction, but the former installer used that checkout only for the UI and requirements. Installing the package from the existing application checkout removes this split without modifying upstream source or runtime behavior. A package version string alone is insufficient provenance because the current default branch's metadata still reports 0.14.7.
