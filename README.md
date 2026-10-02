# RoboTeam and coding workers

RoboTeam provides persistent workspace robots for CLI conversations, delegated ALA tasks, and visible Desktop or Browser work. Explorer's **Open Copilot here** opens the ordinary robot named `default`. AchillesCLI is no longer a separate Ploinky agent.

## Start and configure

Enable `AchillesCLI/roboTeamAgent global no-wait` in Ploinky, or start Explorer, which declares that dependency. RoboTeam uses its existing nestedPodman runtime image. No separate copilot image is required.

New robots enable only Codex. Administrators open Coding agent on an existing robot card to choose Codex, OpenCode or Pi in a dialog. The card displays the enabled agent. The creation form uses Codex automatically. Stop the workstation and tasks before changing it, and open a new chat or terminal afterward. The dashboard selects one agent; the server accepts a `codingAgents` array with any nonempty combination of the three. Existing robots without this setting retain all three until configured. The setting controls managed executables in WebChat, delegated tasks, Desktop, Browser and Open → Terminal; it does not erase account data or restrict user-installed programs.

Open a robot's Desktop from the RoboTeam dashboard and authenticate Codex, OpenCode, or Pi there. The GUI home at `/config` is the same robot home later supplied to ALA. At startup, RoboTeam prepares Codex, OpenCode, Pi, Playwright MCP, computer-use-linux and Supergateway in the shared tool cache in the background. Robot starts reuse these tools. An immediate request may wait for preparation; failures are logged and retried on demand.

```bash
ploinky cli roboTeamAgent --robot default --dir /workspace/project
```

The chat URL is `/webchat?agent=roboTeamAgent&robot=default&workspace-dir=achilles-cli&forward-envelope=1`. Every robot card also has **Open → Copilot**, which uses `achilles-cli/` below the Ploinky workspace. The copilot creates that folder if missing and reuses it otherwise.

RoboTeam installs a shared Soul Gateway plugin in every robot's global OpenCode plugins directory. At native OpenCode initialization, the plugin discovers the local gateway's models and adds them to the in-memory provider configuration. Manual terminal launches, WebChat's model selector and ALA execution use the same plugin. No generated `opencode.json`, model list or periodic polling is required. Manage upstream accounts once in Soul Gateway. Selecting the robot's coding backend remains a separate setting. See [Soul Gateway models](roboTeamAgent/docs/operations.html#soul-gateway-models).

ALA is provided through `link-install`: Ploinky clones `https://github.com/AssistOS-AI/AdvancedLanguageAgent.git` into the workspace only when no matching checkout exists. `/Agent/linked/AdvancedLanguageAgent` links to that editable checkout. Existing clones and local edits are preserved; there is no automatic pull. RoboTeam no longer installs ALA through npm.

## Conversations and tasks

Opening Copilot creates `.roboteam/` in the selected folder, with a `.gitignore` containing `*` so none of it reaches the project's repository. That folder owns its conversations, task definitions, logs and execution records; `/session` and `/tasks` operate on that folder only. ALA writes the conversation text to `.roboteam/.ala/sessions/<sessionId>.jsonl`: user messages, intermediate coding-agent output, final answers and the native continuation. RoboTeam keeps its own turn metadata in `.roboteam/sessions/<sessionId>.json`, such as attachments, task cards and slash-command turns, and reads the text only through ALA's transcript module. A robot owns its home and native account configuration. Each conversation owns its cwd, ALA/native session ID, transcript and selected skills. A turn is one execution in that conversation. Independent CLI conversations and Simple tasks may run concurrently on the same robot. One conversation permits one execution at a time.

Desktop and Browser share one GUI container and one FIFO task queue per robot. A mode or cwd change replaces the idle container. Completing a task leaves the GUI available.

Use `/session`, `/session new`, `/session resume <id>`, `/tasks`, `/model`, and `/permissions`. Pi does not support `ask-for-approval` and rejects it. `full-access` still runs inside ALA's Bubblewrap boundary.

The three bundled skills live in `roboTeamAgent/copilot/src/skills`. Their `copilot` skillset is available only to `default`, where it is selected automatically. Manage repositories in RoboTeam and conversation skill selection on RoboTeam's Conversation skills page (WebChat menu). A saved conversation captures current configured files before each execution. The CLI uses those skills but does not list, add, remove, reload or change them. Use `/list robots` to discover workspace robots.

## Workflow graphs

Use the dashboard's Workflow types panel to describe and generate a graph. In the editor, Flow settings, Generate and Graph open separate right-side pages beside the task list. Select a task to edit it, or use + to add a task with its execution type and skillsets. Drag either centered side port to a port on another node to create a directed edge; dropping elsewhere cancels it. Double-click a node to set the highlighted entry point. Select an edge on Graph and press Delete or Backspace to remove it. RoboFlow selects an available robot covering all required skillsets; a yellow warning identifies uncovered workflows without blocking Save or Start.

The front copilot selects saved workflows through launch-workflow. The protected default workflow contains one node using the default robot and requires a mode:

```text
/exec launch-workflow {"action":"start","workflowTypeId":"default","executionType":"terminal","objective":"Review this project"}
```

Other workflows determine execution mode per task. Branching tasks return an outgoing edge; single-edge and terminal nodes need only a final response. Repeated visits create distinct task instances. Desktop and browser share the selected robot's GUI queue.

RoboFlow embeds SQLite at `/data/roboflow/roboflow.sqlite`; no database server is required. The existing runtime image supports node:sqlite and installation checks it. Exactly three application tables store current workflow types, run snapshots and task instances. Legacy workflow JSON definitions are deleted at startup without migration. Definitions and execution metadata are global; logs and final responses remain under `.roboteam/roboflow/` in the execution folder. The monitoring page shows graph state and every visit. See [the graph contract](roboTeamAgent/docs/specs/DS007-roboflow-team-workflow.md).

ALA must include the caller `--systemPromptFile` option. Ploinky's link-install uses the workspace checkout; update that checkout together with RoboTeam.

Deleting a robot leaves project history intact. A saved native conversation remains bound to its original robot and can fail to resume if that robot or its native state is gone. Conversations and task records live in the opened folder under `.roboteam/`; they are not read from robot-scoped or workspace-wide locations. An old `.achilles-cli/` directory is never read. On first startup RoboTeam deletes each registered project's `.achilles-cli/` and `.ala-pi-sessions/` and each robot home's `.ala/sessions/`, without following symbolic links, and records a marker so this runs once. The active contracts are in [RoboTeam documentation](roboTeamAgent/docs/index.html).

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

## Execution summaries

Every robot, including default and existing robots, always receives the required human-report skill from DocumentationSkills. Ploinky resolves the workspace checkout or prepares its internal repository copy. The required skill is shown as view-only in Manage skills and cannot be disabled through the skill selection API. An unavailable required source prevents execution.

Every user prompt, including a continuation, requires the entire final response between identical <<human-report>> markers on separate lines, following the human-report skill. WebChat has no View Summary button. Each workflow phase exposes a human-report tab that lists complete reports without their markers and refreshes during execution. A conversation's reports are read on demand from the agent messages and final answers that ALA recorded in its transcript. Workflow output uses byte ranges, which the endpoint reads instead of searching all output; historical workflow results are indexed lazily, and historical raw logs without output provenance are excluded. No separate summary text file is written. Continuing a workflow phase appends to its existing result file and retains references to earlier results, while normal result reads return the latest response.

## Sequential child workflows

Mark a task as a [Workflow creator](roboTeamAgent/docs/wiki.html#definition-workflow-creator) to let its robot choose ordinary routing or delegate to sequential child workflows. Connect the shared Run workflows node to continuation tasks. Children cannot contain creators. Children run in array order. A failed child blocks later children until Continue completes it successfully; a stopped child waits for Resume. Each child receives the final response of the preceding child’s last task. Parent Stop stops active phases and children; Resume continues only stopped work. The creator's Sub-flows tab lists child states and links. See [Robots & Runs](roboTeamAgent/docs/operations.html) and [DS007](roboTeamAgent/docs/specs/DS007-roboflow-team-workflow.md).

The bundled **Code Development** preset follows Planning → Execution → Run workflows → Validation. Execution is a creator and delegates implementation parts to child workflows before Validation checks the integrated result. The preset uses terminal tasks, is read-only and cannot be edited or deleted. RoboTeam creates it at startup only when absent and applies the targeted routing update to older presets. Existing run snapshots remain unchanged.

ALA output in View thinking, workflow phase and generation logs, WebChat task logs, and human reports uses the same Markdown renderer as final WebChat messages. Consecutive output lines render as complete blocks so headings, lists, tables and fenced code survive live updates. Raw HTML is escaped and links allow only HTTP(S). File paths and words receive no custom token highlighting. Stored logs and report offsets remain unchanged.

Final responses remain Markdown and use heavier text with a subtle bordered background, without extra labels. View thinking also includes the completed response when it was not recorded in the log.

Enable **Allows human input** in a workflow task to let its robot pause for a business decision missing from the prompt and context. In Explorer, open **Observability → Requires human input**, select the stopped workflow, choose one of three suggestions or write a custom answer, then select **Send answer**. RoboFlow continues the same robot session and follows the graph after that task finishes. This tab also lists other stopped and failed workflows.
