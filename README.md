# RoboTeam and coding workers

RoboTeam provides persistent workspace robots for CLI conversations, delegated ALA tasks, and visible Desktop or Browser work. Explorer's **Open Copilot here** opens the ordinary robot named `default`. AchillesCLI is no longer a separate Ploinky agent.

## Start and configure

Enable `AchillesCLI/roboTeamAgent global no-wait` in Ploinky, or start Explorer, which declares that dependency. RoboTeam uses its existing nestedPodman runtime image. No separate copilot image is required.

New robots enable only OpenCode. Administrators open Coding agent on an existing robot card to choose Codex, OpenCode, Pi or Claude Code in a dialog. The card displays the enabled agent. Selecting Pi shows a yellow warning that it is not compatible with Browser and Desktop executions. GUI tasks inherit the robot home coding agent without forcing a compatible replacement. The creation form uses OpenCode automatically. Stop the workstation and tasks before changing it, and open a new chat or terminal afterward. The dialog also has a searchable Default model selector that loads the native `/model` catalog only when opened and then offers the model's supported efforts and saves both as robot defaults for subsequent executions, including workflows. The dashboard selects one agent; the server accepts a `codingAgents` array with any nonempty combination of the four. Existing robots without this setting retain all four until configured. The setting controls managed executables in WebChat, delegated tasks, Desktop, Browser and Open → Terminal; it does not erase account data or restrict user-installed programs. The robot home's `.ala/config.json` records the selected agent as `codingAgent` and holds one model and effort per agent; changing the agent keeps the models chosen for the others, while chat `/model` stores a session-only `modelOverride` in `.roboteam/sessions/<sessionId>/config.json`. `/model default` removes it and inherits the robot default. Session overrides go to ALA through `--model` and `--effort`; workflows without overrides read the robot home directly. No intermediate ALA config is generated.

Open a robot's Desktop from the RoboTeam dashboard and authenticate Codex, OpenCode, or Pi there. Log Claude Code in from the robot's Terminal by running `claude`; its login stays in the robot home's `.claude` directory, and RoboTeam never handles those credentials. The GUI home at `/config` is the same robot home later supplied to ALA. At startup, RoboTeam prepares Codex, OpenCode, Pi, Claude Code, Playwright MCP, computer-use-linux and Supergateway in the shared tool cache in the background. Robot starts reuse these tools. An immediate request may wait for preparation; failures are logged and retried on demand.

```bash
ploinky cli roboTeamAgent --robot default --dir /workspace/project
```

The chat URL is `/webchat?agent=roboTeamAgent&robot=default&workspace-dir=achilles-cli&forward-envelope=1`. Every robot card also has **Open → Copilot**, which uses `achilles-cli/` below the Ploinky workspace. The copilot creates that folder if missing and reuses it otherwise.

RoboTeam installs a shared Soul Gateway plugin in every robot's global OpenCode plugins directory. At native OpenCode initialization, the plugin discovers the local gateway's models and adds them to the in-memory provider configuration. Manual terminal launches, WebChat's model selector and ALA execution use the same plugin. No generated `opencode.json`, model list or periodic polling is required. Manage upstream accounts once in Soul Gateway. Selecting the robot's coding backend remains a separate setting. Claude Code does not use Soul Gateway; it runs only Claude's own models. See [Soul Gateway models](roboTeamAgent/docs/operations.html#soul-gateway-models).

ALA is provided through `link-install`: Ploinky clones `https://github.com/AssistOS-AI/AdvancedLanguageAgent.git` into the workspace only when no matching checkout exists. `/Agent/linked/AdvancedLanguageAgent` links to that editable checkout. Existing clones and local edits are preserved; there is no automatic pull. RoboTeam no longer installs ALA through npm.

## Conversations and tasks

Opening Copilot creates `.roboteam/` in the selected folder, with a `.gitignore` containing `*` so none of it reaches the project's repository. That folder owns its conversations, task definitions, logs and execution records; `/session` and `/tasks` operate on that folder only. ALA writes the conversation text to `.roboteam/.ala/sessions/<sessionId>.jsonl`: user messages, intermediate coding-agent output, final answers and the native continuation. RoboTeam keeps its own turn metadata in `.roboteam/sessions/<sessionId>/config.json`, such as attachments, task cards and slash-command turns, and reads the text only through ALA's transcript module. A robot owns its home and native account configuration. Each conversation owns its cwd, ALA/native session ID, transcript and selected skills. A turn is one execution in that conversation. Independent CLI conversations and Simple tasks may run concurrently on the same robot. One conversation permits one execution at a time. Its private `skills/` directory combines existing project skills with the robot selection and is mounted read-only at `.agents/skills` for that execution, so concurrent robots do not overwrite shared skill links.

Desktop and Browser share one GUI container and one FIFO task queue per robot. A mode or cwd change replaces the idle container. Completing a task leaves the GUI available.

Use `/session`, `/session new`, `/session resume <id>`, `/tasks`, `/model`, and `/permissions`. Pi does not support `ask-for-approval` and rejects it. `full-access` still runs inside ALA's Bubblewrap boundary.

The bundled skills live in `roboTeamAgent/copilot/src/skills`. Their `copilot` skillset (bash and launch-gpt-researcher) is available only to `default`, where it is selected automatically. Every robot opened in WebChat also receives `list-workflows` and `launch-workflow` as required, read-only skills; robot tasks and workflow phases do not. Manage repositories in RoboTeam and conversation skill selection on RoboTeam's Conversation skills page (WebChat menu). A saved conversation captures current configured files before each execution. The CLI uses those skills but does not list, add, remove, reload or change them. Use `/list robots` to discover workspace robots.

## Workflow graphs

Use the dashboard's Workflow types panel to describe and generate a graph. In the editor, Flow settings, Generate and Graph open separate right-side pages beside the task list. Select a task to edit it, or use + to add a task with its execution type and skillsets. Drag either centered side port to a port on another node to create a directed edge; dropping elsewhere cancels it. Double-click a node to set the highlighted entry point. Select an edge on Graph and press Delete or Backspace to remove it. RoboFlow selects an available robot covering all required skillsets; a yellow warning identifies uncovered workflows without blocking Save or Start.

The front copilot calls list-workflows to get the current workflow ids, then starts one through launch-workflow. The protected default workflow contains one node using the default robot and requires a mode:

```text
/exec launch-workflow {"action":"start","workflowTypeId":"default","executionType":"terminal","objective":"Review this project"}
```

Workflow generation, branching and sub-flow delegation use structured Markdown fields that a common parser converts into objects. Legacy JSON responses remain accepted. Prompts can contain multiline text without JSON escaping; reserved field headings inside a prompt must be protected by an enclosing code fence. Tool arguments keep their current formats.

Other workflows determine execution mode per task. Branching tasks return an outgoing edge; single-edge and terminal nodes need only a final response. Repeated visits create distinct task instances. Desktop and browser share the selected robot's GUI queue.

RoboFlow embeds SQLite at `/data/roboflow/roboflow.sqlite`; no database server is required. The existing runtime image supports node:sqlite and installation checks it. Exactly three application tables store current workflow types, run snapshots and task instances. Legacy workflow JSON definitions are deleted at startup without migration. Definitions and execution metadata are global; logs and final responses remain under `.roboteam/roboflow/` in the execution folder. The monitoring page shows graph state and every visit. See [the graph contract](roboTeamAgent/docs/specs/DS007-roboflow-team-workflow.md).

ALA has no system-prompt option. RoboTeam puts the caller's system instructions in the first turn prompt of each native session and sends that prompt as the first `--control-stdin` record. Ploinky's link-install uses the workspace checkout; update that checkout together with RoboTeam.

Deleting a robot leaves project history intact. A saved native conversation remains bound to its original robot and can fail to resume if that robot or its native state is gone. Conversations and task records live in the opened folder under `.roboteam/`; they are not read from robot-scoped or workspace-wide locations. An old `.achilles-cli/` directory is never read. On first startup RoboTeam deletes each registered project's `.achilles-cli/` and `.ala-pi-sessions/` and each robot home's `.ala/sessions/`, without following symbolic links, and records a marker so this runs once. The active contracts are in [RoboTeam documentation](roboTeamAgent/docs/index.html).

## Verification

```bash
node tests/run-all.mjs
cd roboTeamAgent
node --test tests/*.test.mjs
```

GPTResearcher remains an optional Ploinky worker. Codex, OpenCode, Pi and Claude Code run through ALA inside RoboTeam, not through separate Ploinky agents.

Skill repositories are managed from each robot’s **Manage skills** dialog. Their optional `skillsets.md` defines named combinations with Description and Skills sections. The graph editor discovers named skillsets through Ploinky. RoboFlow matches their canonical repository-source identities against each robot catalog.

See [Skills & Skillsets](roboTeamAgent/docs/skills.html) for repository management, Markdown definitions and the execution catalog flow.

Local instruction skills use live conversation policies and capture current files at execution start. See [local skill discovery](roboTeamAgent/docs/local-skills.html).

## Execution summaries

Every robot, including default and existing robots, always receives the required human-report skill from DocumentationSkills. Ploinky resolves the workspace checkout or prepares its internal repository copy. The required skill is shown as view-only in Manage skills and cannot be disabled through the skill selection API. An unavailable required source prevents execution.

Every user prompt, including a continuation, requires one final response with exactly one plain-language report between identical <<human-report>> markers on separate lines. In WebChat and tasks without an explicit machine-readable output contract, this report is the entire answer. All workflow execution tasks, including tasks with zero or one outgoing edge, and graph generation put the technical Markdown after the closing marker in the same final response. Control fields remain outside the report, and workflow tasks include a concise, self-contained technical handoff in the nextNodePrompt field. Markers must not be repeated in progress messages, formatting explanations or draft examples. WebChat has no View Summary button. Each workflow phase exposes a human-report tab that lists complete reports without their markers and refreshes during execution. A conversation's reports are read on demand from the agent messages and final answers that ALA recorded in its transcript. Workflow output uses byte ranges, which the endpoint reads instead of searching all output; historical workflow results are indexed lazily, and historical raw logs without output provenance are excluded. No separate summary text file is written. Continuing a workflow phase appends to its existing result file and retains references to earlier results, while normal result reads return the latest response.

## Sequential child workflows

Mark a task as a [Workflow creator](roboTeamAgent/docs/wiki.html#definition-workflow-creator) to let its robot choose ordinary routing or delegate to sequential child workflows. Connect the shared Run workflows node to continuation tasks. Children cannot contain creators. Children run in array order. A failed child blocks later children until Continue completes it successfully; a stopped child waits for Resume. Each child receives the final response of the preceding child’s last task. Parent Stop stops active phases and children; Resume continues only stopped work. The creator's Sub-flows tab lists child states and links. See [Robots & Runs](roboTeamAgent/docs/operations.html) and [DS007](roboTeamAgent/docs/specs/DS007-roboflow-team-workflow.md).

The bundled **Code Development** preset follows Planning → Run workflows → Validation → Finish. Planning delegates implementation to sequential child workflows. Validation sends incomplete work back to Planning or proceeds to Finish, which reports what was implemented and verified. All robot phases use terminal execution. The preset is read-only and cannot be edited or deleted. Startup synchronizes its graph, prompts and skill requirements; existing run snapshots remain unchanged.

ALA output in View thinking, workflow phase and generation logs, WebChat task logs, and human reports uses the same Markdown renderer as final WebChat messages. Consecutive output lines render as complete blocks so headings, lists, tables and fenced code survive live updates. Raw HTML is escaped and links allow only HTTP(S). File paths and words receive no custom token highlighting. Stored logs and report offsets remain unchanged.

Final responses remain Markdown and use heavier text with a subtle bordered background, without extra labels. View thinking also includes the completed response when it was not recorded in the log.

Enable **Allows human input** in a workflow task to let its robot pause for a business decision missing from the prompt and context. In Explorer, open **Observability → Requires human input**, select the stopped workflow, choose one of three suggestions or write a custom answer, then select **Send answer**. RoboFlow continues the same robot session and follows the graph after that task finishes. This tab also lists other stopped and failed workflows.

Workflow phase executions receive the internal, required, view-only `report-task-blocked` skill. WebChat and standalone tasks do not receive it. The skill is mounted read-only for each execution, never installed in the robot home or linked permanently into the project. When resources or capabilities prevent following the requested plan, its script accepts `{ "message": "where work stopped and why" }` and terminates ALA with that error. The workflow phase becomes failed directly. Other phases are not stopped, and the workflow retains its existing status priority. The skill is not a selectable skillset member.
