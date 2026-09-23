# RoboTeam and coding workers

RoboTeam provides persistent workspace robots for CLI conversations, delegated ALA tasks, and visible Desktop or Browser work. Explorer's **Open Copilot here** opens the ordinary robot named `default`. AchillesCLI is no longer a separate Ploinky agent.

## Start and configure

Enable `AchillesCLI/roboTeamAgent global no-wait` in Ploinky, or start Explorer, which declares that dependency. RoboTeam uses its existing nestedPodman runtime image. No separate copilot image is required.

New robots enable only Codex. Administrators open Coding agent on an existing robot card to choose Codex, OpenCode or Pi in a dialog. The card displays the enabled agent. The creation form uses Codex automatically. Stop the workstation and tasks before changing it, and open a new chat or terminal afterward. The dashboard selects one agent; the server accepts a `codingAgents` array with any nonempty combination of the three. Existing robots without this setting retain all three until configured. The setting controls managed executables in WebChat, delegated tasks, Desktop, Browser and Open → Terminal; it does not erase account data or restrict user-installed programs.

Open a robot's Desktop from the RoboTeam dashboard and authenticate Codex, OpenCode, or Pi there. The GUI home at `/config` is the same robot home later supplied to ALA. At startup, RoboTeam prepares Codex, OpenCode, Pi, Playwright MCP, computer-use-linux and Supergateway in the shared tool cache in the background. Robot starts reuse these tools. An immediate request may wait for preparation; failures are logged and retried on demand.

```bash
ploinky cli roboTeamAgent --robot default --dir /workspace/project
```

The chat URL is `/webchat?agent=roboTeamAgent&robot=default&workspace-dir=.&forward-envelope=1`. Every robot card also has **Open → Chat**.

RoboTeam installs a shared Soul Gateway plugin in every robot's global OpenCode plugins directory. At native OpenCode initialization, the plugin discovers the local gateway's models and adds them to the in-memory provider configuration. Manual terminal launches, WebChat's model selector and ALA execution use the same plugin. No generated `opencode.json`, model list or periodic polling is required. Manage upstream accounts once in Soul Gateway. Selecting the robot's coding backend remains a separate setting. See [Soul Gateway models](roboTeamAgent/docs/operations.html#soul-gateway-models).

ALA is provided through `link-install`: Ploinky clones `https://github.com/AssistOS-AI/AdvancedLanguageAgent.git` into the workspace only when no matching checkout exists. `/Agent/linked/AdvancedLanguageAgent` links to that editable checkout. Existing clones and local edits are preserved; there is no automatic pull. RoboTeam no longer installs ALA through npm.

## Conversations and tasks

Opening Copilot creates `.achilles-cli/` in the selected folder. That folder owns its conversations, task definitions, logs and execution records; `/session` and `/tasks` operate on that folder only. A robot owns its home and native account configuration. Each conversation owns its cwd, ALA/native session ID, transcript and selected skills. A turn is one execution in that conversation. Independent CLI conversations and Simple tasks may run concurrently on the same robot. One conversation permits one execution at a time.

Desktop and Browser share one GUI container and one FIFO task queue per robot. A mode or cwd change replaces the idle container. Completing a task leaves the GUI available.

Use `/session`, `/session new`, `/session resume <id>`, `/tasks`, `/model`, and `/permissions`. Pi does not support `ask-for-approval` and rejects it. `full-access` still runs inside ALA's Bubblewrap boundary.

The three bundled skills live in `roboTeamAgent/copilot/src/skills`. Their `copilot` skillset is available only to `default`, where it is selected automatically. Manage repositories in RoboTeam and conversation skill selection in Explorer. A saved conversation captures current configured files before each execution. The CLI uses those skills but does not list, add, remove, reload or change them. Use `/list robots` to discover workspace robots.

## Workflow graphs

Use the dashboard's Workflow types panel to describe and generate a graph, refine task nodes and connections, then Save. Each task declares a name, description, skillsets and terminal, desktop or browser execution. Nodes have an explicit entry and directed outgoing edges. RoboFlow selects an available robot covering all required skillsets; a yellow warning identifies uncovered workflows without blocking Save or Start.

The front copilot selects saved workflows through launch-workflow. The protected default workflow contains one node using the default robot and requires a mode:

```text
/exec launch-workflow {"action":"start","workflowTypeId":"default","executionType":"terminal","objective":"Review this project"}
```

Other workflows determine execution mode per task. Branching tasks return an outgoing edge; single-edge and terminal nodes need only a final response. Repeated visits create distinct task instances. Desktop and browser share the selected robot's GUI queue.

RoboFlow embeds SQLite at `/data/roboflow/roboflow.sqlite`; no database server is required. The existing runtime image supports node:sqlite and installation checks it. Exactly three application tables store current workflow types, run snapshots and task instances. Legacy workflow JSON definitions are deleted at startup without migration. Definitions and execution metadata are global; logs and final responses remain under `.achilles-cli/roboflow/` in the execution folder. The monitoring page shows graph state and every visit. See [the graph contract](roboTeamAgent/docs/specs/DS007-roboflow-team-workflow.md).

ALA must include the caller `--systemPromptFile` option. Ploinky's link-install uses the workspace checkout; update that checkout together with RoboTeam.

Deleting a robot leaves project history intact. A saved native conversation remains bound to its original robot and can fail to resume if that robot or its native state is gone. Conversations and task records live in the opened folder under `.achilles-cli/`; they are not read from robot-scoped or workspace-wide locations. The active contracts are in [RoboTeam documentation](roboTeamAgent/docs/index.html).

## Verification

```bash
node tests/run-all.mjs
cd roboTeamAgent
node --test tests/*.test.mjs
```

GPTResearcher remains an optional Ploinky worker. Codex, OpenCode and Pi run through ALA inside RoboTeam, not through separate Ploinky agents.

Skill repositories are managed from each robot’s **Manage skills** dialog. Their optional `skillsets.md` defines named combinations with Description and Skills sections. The graph editor discovers named skillsets through Ploinky. RoboFlow matches their canonical repository-source identities against each robot catalog.

See [Skills & Skillsets](roboTeamAgent/docs/skills.html) for repository management, Markdown definitions and the execution catalog flow.

Local instruction skills use live conversation policies and capture current files at execution start. See [local skill discovery](roboTeamAgent/docs/local-skills.html).
