# AchillesCLI

AchillesCLI is primarily a local command-line agent for working with code and reusable Achilles skill definitions inside a selected project directory. It can also run as a Ploinky agent and provide the same skill-aware runtime through the dedicated Ploinky WebChat interface.

## Overview

The trusted `achilles-cli/src/cli.mjs` entry point establishes the workspace boundary and starts `AchillesBroker`. The broker owns Bash approval state and launches the sandboxed `achilles-cli/src/index.mjs` process, where AchillesAgentLib provides `MainAgent`, `LLMAgent`, skill discovery, and skill execution. The runtime supports a one-prompt command, an interactive REPL, and Ploinky WebChat messages. It also persists conversation state and delegated background-task journals under the selected workspace.

The repository includes the AchillesCLI agent plus Ploinky manifests for the optional GPTResearcher, OpenCode, PI, and Codex workers used by launcher skills. Detailed runtime behavior is documented in [the technical documentation](docs/index.html), canonical terms are defined in [the wiki](docs/wiki.html), and requirements are indexed in [the specification matrix](docs/specsLoader.html?spec=matrix.md).

## Prerequisites

- Node.js 20 or newer for the ES-module runtime and test suite.
- Ploinky with the workspace-shared `achillesAgentLib` dependency and Soul Gateway proxy used by `achilles-cli/manifest.json`.
- Bubblewrap on Linux. `achilles-cli/scripts/installPrerequisites.sh` installs it through the agent image's supported package manager when necessary.

## Installation and startup

Install or enable the repository as a Ploinky agent, then start an interactive session from the project directory that AchillesCLI may access:

```bash
ploinky cli achilles-cli
```

Pass a prompt after the agent name for one-shot execution:

```bash
ploinky cli achilles-cli "list all skills"
```

The manifest runs `node /code/src/cli.mjs`. For standalone use without Ploinky, install the package dependencies and start the same runtime from the agent directory:

```bash
cd achilles-cli
npm install
npm start -- --dir ./example-workspace
```

## Configuration

`--dir <path>` selects the sandboxed working directory, and repeatable `--skill-root <path>` options add session-only skill roots. `--permissions ask-for-approval` requires a decision for each new Bash call; `--permissions full-access` starts Bash calls without prompting but does not widen the workspace sandbox. `/permissions` persists the selected mode in `<workspace>/.achilles-cli/settings.json`, while an explicit startup option overrides the saved value only for that process.

`/model <model-name>` stores an explicit Soul Gateway model selection in the same settings file. `/tier` removes that explicit selection and returns routing to the configured tier strategy. All model calls go through AchillesAgentLib `LLMAgent`; repository code does not call a model provider directly.

The Ploinky manifest accepts `WORKSPACE_PATH`, `ACHILLES_MODEL_PLAN`, `ACHILLES_MODEL_CODE`, and `ACHILLES_DEBUG` from its runtime environment. Runtime configuration may supply manual overrides in code when a host integration needs values that differ from environment defaults.

## Basic usage

Common interactive commands include:

```text
/list skills
/read <skill-name>
/write <skill-name> [type]
/validate <skill-name>
/generate <skill-name>
/test [skill-name]
/run-tests [skill-name|all]
/refine <skill-name>
/exec <skill-name> [input]
/skills
/permissions
/model
/tasks
```

Run the repository integration suite with:

```bash
node tests/run-all.mjs
```

Package-local behavior is also covered by the tests under `achilles-cli/tests/`.
