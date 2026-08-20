---
title: DS003-main-behavior
summary: Defines the essential prompt execution, skill lifecycle, workspace confinement, and delegated-task behaviors that let users complete work through AchillesCLI.
---

## Introduction

AchillesCLI is primarily a local command-line agent that lets a user work with code and reusable agent skills inside a selected project directory. It converts a prompt or slash command into a skill-aware result, preserves the session's workspace boundary, and can hand long-running work to supported coding or research agents. Ploinky may host the same runtime and expose it through its dedicated WebChat interface without changing these core contracts.

## Core Content

### Main Behavior Components

| Name | Explanation |
| --- | --- |
| Prompt execution across CLI surfaces | A user can submit work in single-shot, interactive REPL, or WebChat mode and receive one result through the same skill-aware agent runtime. |
| Skill lifecycle and execution | A user can discover, inspect, create, validate, generate, test, refine, enable, disable, and execute supported skill definitions. |
| Workspace-confined Bash execution | AchillesCLI confines the MainAgent and Bash child processes to the selected workspace while the trusted Broker controls command approval state. |
| Persistent delegated tasks | A user can start, inspect, stop, and continue work delegated to supported external agents while AchillesCLI preserves task identity, logs, and continuation state. |

### Prompt execution across CLI surfaces

The user initiates this behavior by invoking `achilles-cli` with a prompt, starting the terminal REPL without a prompt, or sending a WebChat envelope. `src/cli.mjs` establishes the trusted boundary and starts `src/index.mjs`; the sandboxed runtime creates the AchillesAgentLib `MainAgent`, routes every model call through `LLMAgent`, loads applicable skills, and returns the agent's final answer through the active interface. Single-shot execution terminates after the answer, the REPL continues until an exit command, and WebChat continues to accept structured messages. These modes may adapt input and presentation, but they must use the same skill-aware execution contract and the runtime configuration described in [DS002](specsLoader.html?spec=DS002-llm-model-strategy.md), [DS004](specsLoader.html?spec=DS004-entrypoint-runtime-bootstrap.md), and [DS005](specsLoader.html?spec=DS005-repl-and-command-processing.md).

### Skill lifecycle and execution

The user initiates this behavior through slash commands such as `/list skills`, `/read`, `/write`, `/validate`, `/generate`, `/test`, `/run-tests`, `/refine`, `/exec`, `/skill`, and `/skills`. AchillesCLI discovers built-in and workspace skill roots, validates descriptor families through `src/schemas/skillSchemas.mjs`, and delegates each command to the matching built-in skill or deterministic handler. The observable result is a created or updated skill artifact, a validation or test result, a generated executable module, an execution result, or an updated workspace enablement setting. Skill descriptors remain the authoritative input; runtime code must not silently replace their schema contract. [DS007](specsLoader.html?spec=DS007-skills-runtime-and-builtins.md) and [DS008](specsLoader.html?spec=DS008-schemas-and-skill-doc-contract.md) own the detailed contracts.

### Workspace-confined Bash execution

The user initiates local command execution when the selected skill invokes the Bash tool. The trusted `AchillesBroker` remains outside Bubblewrap, stores the authoritative `ask-for-approval` or `full-access` mode, and authorizes Bash requests without executing them. `LocalBashExecutor` starts approved commands as children of the sandboxed MainAgent, so they inherit the same filesystem namespace and cannot gain host access through approval. A denied request returns a normal planner result and lets the turn continue; an approved request returns captured command output to the agentic session. The workspace selected at launch is the invariant boundary, and neither a permission-mode change nor an exact-call approval may widen it. [DS014](specsLoader.html?spec=DS014-global-architecture.md) owns the detailed security boundary.

### Persistent delegated tasks

The user initiates delegation by requesting a supported coding or research agent or by executing a launcher skill. AchillesCLI starts the target through Ploinky and AgentServer interfaces, records a stable local task identifier and lifecycle journal under `.achilles-cli/tasks/`, streams or stores provider output, and returns an immediate acknowledgement for asynchronous work. `/tasks` and `/task view|stop|continue` expose the observable lifecycle without transferring persistence ownership to WebChat. Continuation creates a new remote execution while retaining the local task identity and opaque provider handle. Provider-specific launch, sandbox, model, and output rules remain in [DS010](specsLoader.html?spec=DS010-ecosystem-integration.md), [DS012](specsLoader.html?spec=DS012-opencode-launcher-delegation.md), and [DS013](specsLoader.html?spec=DS013-codex-launcher-delegation.md).
