---
title: DS003-main-behavior
summary: Defines the primary behaviors that produce a workspace research report from web and optional local evidence.
---

## Introduction

GPTResearcher's central outcome is a saved research report that an authorized caller can inspect and reuse. Three behaviors determine whether that outcome is correct, bounded, and repeatable.

## Core Content

### Main Behavior Components

| Name | Explanation |
| --- | --- |
| Research report production | An authorized caller supplies a question and receives a Markdown report saved in the selected workspace. |
| Evidence-source selection | The agent uses web research alone or combines it with real local documents according to the request and available files. |
| Routed model and search execution | The agent applies persistent non-secret choices while keeping model and search credentials inside Soul Gateway and SearchAgent. |

### Research report production

An AchillesCLI user or authorized Ploinky caller initiates research with a non-empty `query`. GPTResearcher must conduct research, write the requested report type, save the report under the resolved working directory, and return a structured result that identifies the report path. Failure must return a bounded error and log tail without presenting an incomplete file as a completed report.

### Evidence-source selection

The caller may disable local documents explicitly. Otherwise GPTResearcher must inspect the authorized working directory and select hybrid research only when usable local files exist. It must use web-only research when local documents are disabled or absent. The list of local files must not be appended to the web query, and `workingDir` must remain confined to `WORKSPACE_PATH`.

### Routed model and search execution

GPTResearcher must apply its selected fast, smart, strategic, and embedding models through Soul Gateway and must send every web query through SearchAgent with the configured provider key. This routing keeps credentials and provider-specific response handling outside the report pipeline. Settings updates must persist across worker recreation without persisting secrets.
