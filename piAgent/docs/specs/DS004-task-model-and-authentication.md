---
title: DS004-task-model-and-authentication
summary: Defines PI Agent's MCP tools, continuation controls, model resolution, authentication, and operational lifecycle.
---

## Introduction

PI Agent exposes provider-neutral task operations to AchillesCLI while retaining PI-specific sessions, provider selection, thinking level, credentials, and sandbox state inside the worker.

## Core Content

| Tool or endpoint | Contract |
| --- | --- |
| `execute-task` | Requires prompt and project directory, accepts an optional model, runs asynchronously with full retained logs, and advertises continuation. |
| `continue-task` | Requires an opaque handle and prompt, accepts optional provider and model overrides, and resumes the stored PI session asynchronously. |
| `task-session-control` | Performs typed provider authentication operations against private task-session state. |
| Models endpoint | Publishes PI-compatible model choices to Ploinky without revealing credentials. |

Initial tasks outside generated-local mode must let PI own model selection unless an authorized caller provides an override. Generated-local tasks must use the scoped Soul provider contract and an allowed Soul tier. Continuation must merge the persistent global settings with project-local `.pi/settings.json`, prefer valid project values, and pass the resolved provider, model, and thinking level to PI. Invalid settings must not corrupt the stored session.

The task environment must exclude raw Ploinky agent, client, private, master, invocation, and router credentials as well as provider secret variables. Generated-local routing must place a random task token in the sandbox and keep the signed agent key in the outer loopback broker.

`execute-task` and `continue-task` must remain internal asynchronous tools with no elapsed provider timeout. They run until PI exits, the user cancels, the process fails, or the runtime stops. The worker must remain `startup: manual`, and readiness must prove both the sandbox guard and a real PI invocation path.
