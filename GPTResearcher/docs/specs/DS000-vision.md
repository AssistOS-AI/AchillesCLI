---
title: DS000-vision
summary: Defines GPTResearcher's purpose, supported outcomes, and product boundaries.
---

## Introduction

GPTResearcher exists to turn a research question into a durable Markdown report by combining model-guided investigation, web search, and optional workspace documents. It serves AchillesCLI and other authorized Ploinky callers that need a report rather than an interactive coding session.

## Core Content

GPTResearcher must accept a non-empty research query, run the GPT Researcher pipeline, and save the resulting report inside the authorized working directory. The result must identify the saved report and may include sources, collected research context, images, costs, and bounded diagnostic output when the upstream library provides them.

The agent must use Soul Gateway for language and embedding models and SearchAgent for web retrieval. Search-provider credentials must remain with SearchAgent, while model credentials and generated Ploinky identity must remain outside report content and persistent non-secret settings.

The research source mode must reflect the caller's intent and available files. Hybrid mode may expose the authorized working directory through `DOC_PATH`; web-only mode must not expose local documents. An empty local-document directory must fall back to web research rather than claiming hybrid input that does not exist.

| Product boundary | Required outcome |
| --- | --- |
| Workspace writes | Reports are written only inside the resolved `WORKSPACE_PATH` boundary. |
| Web retrieval | Every web query is routed through SearchAgent. |
| Model access | Chat and embedding requests are routed through Soul Gateway. |
| Persistent settings | Only non-secret model and search-provider choices are stored in the agent home. |
| Startup | The optional worker starts on demand and does not delay ordinary AchillesCLI startup. |
