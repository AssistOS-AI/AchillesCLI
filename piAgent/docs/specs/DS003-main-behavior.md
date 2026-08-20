---
title: DS003-main-behavior
summary: Defines direct PI access, sandboxed delegated coding, and current-setting continuation as the agent's primary behaviors.
---

## Introduction

PI Agent exists so operators and AchillesCLI users can employ PI for coding work while each delegated task remains confined to its selected project and can continue with the provider's current configuration.

## Core Content

### Main Behavior Components

| Name | Explanation |
| --- | --- |
| Direct PI CLI access | An operator starts the native PI CLI through Ploinky and uses persistent provider configuration. |
| Sandboxed delegated coding | AchillesCLI submits asynchronous work that can modify only the selected project and returns live PI output. |
| Provider-session continuation | A later prompt resumes the same PI session with current valid global and project-local model settings. |

### Direct PI CLI access

The operator triggers `ploinky cli piAgent`. Ploinky must run the executable installed under the persistent agent home so interactive authentication and settings are shared with later delegated execution. Direct CLI use remains provider-owned and does not create an AchillesCLI task automatically.

### Sandboxed delegated coding

An authorized caller supplies a prompt and project directory to `execute-task`. PI Agent must establish the task sandbox before project or session mutation, start PI asynchronously, stream readable assistant and tool output, and return bounded final text. The task must fail closed when the project escapes `PLOINKY_WORKSPACE_ROOT` or the nested sandbox cannot prove its required isolation.

### Provider-session continuation

Once PI Agent allocates a provider session, it must persist that session behind an opaque handle even when later execution fails or is cancelled during controlled shutdown. `continue-task` must restore the same session and original project. It must use an explicit authorized override when supplied; otherwise it must resolve current PI global and project-local settings and fall back to native resume behavior when those settings are unavailable or malformed.
