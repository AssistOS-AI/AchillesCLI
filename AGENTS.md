# Scope

RoboTeam is the workspace robot and copilot agent. The conversational runtime lives in `roboTeamAgent/copilot/`; GPTResearcher remains a separate optional research worker.

# Mandatory Reading Order

Read `README.md`, `roboTeamAgent/docs/index.html`, `roboTeamAgent/docs/wiki.html`, the specification matrix and relevant DS files before changing behavior. `roboTeamAgent/docs/specs/DS001-coding-style.md` owns coding style. For conversational internals, inspect `roboTeamAgent/copilot/src/index.mjs`, `server/robot-cli.mjs`, and their tests.

# Current Skill Catalog

The bundled `copilot` repository contains seven self-contained Anthropic skills under `roboTeamAgent/copilot/src/skills/`: bash, launch-gpt-researcher, list-workflows, launch-workflow, workflow-creator, require-human-input, and report-task-blocked. Its only skillset is `copilot` (bash and launch-gpt-researcher), which the default robot mounts automatically. Every robot opened in WebChat also receives list-workflows and launch-workflow as required, read-only skills; robot tasks and workflow phases do not. list-workflows lists the workspace workflow types and launch-workflow only starts one; the front copilot gets no workflow catalog in its prompt. The builtin copilot repository is available only to the default robot. Workflow tasks mount their selected skillsets or, for repositories without declared skillsets, individual skills. RoboFlow owns directed graph execution and chooses robots by matching those selections. The caller supplies system instructions for conversations, generation and branching tasks. The require-human-input skill is internal and read-only, mounted only for tasks with allowsHumanInput:true. Its HTTP script saves a blocking question and ends execution; the same task continues only after a user answers in Observability. The workflow-creator skill is required only for creator task policies and is view-only. Creators may delegate one level of sequential child workflows through the managed Run workflows node; RoboFlow owns the join and group Stop/Resume. Robot routing, creator plans and generated workflow graphs use structured Markdown fields through the common response parser, with JSON as a legacy fallback; tool arguments retain their existing contracts. Every robot also receives the required, read-only human-report skill from DocumentationSkills while workflow executions also receive the bundled report-task-blocked skill through a per-execution read-only mount, never the robot home. The latter accepts only a message through an execution-scoped private HTTP callback, terminates ALA and fails that execution directly. RoboFlow fails only that phase and retains its status priority; WebChat and standalone tasks do not receive this skill or its callback. Every user prompt and continuation requires one plain-language report enclosed in exactly two identical <<human-report>> markers. Ordinary chat ends there; all workflow execution tasks and graph generation append their technical Markdown outside the markers in the same final response. Preserve the complete response for debug logs. Downstream context contains only technical output, with a concise self-contained nextNodePrompt from every workflow execution phase; human reports are user-only. Keep this catalog and RoboTeam documentation synchronized.

# Repository Rules

- Use English for source comments and documentation, ES modules and four-space JavaScript indentation.
- ALA owns coding-agent selection, native sessions and Bubblewrap execution. Do not restore MainAgent or the retired Bash broker as the conversational engine.
- Skills call the real Ploinky MCP client through the Router. Never introduce a parallel MCP bridge or forward master/user-session credentials.
- Robot homes and native accounts are robot-scoped. Copilot conversations and native task history belong to the opened folder under `.roboteam/`. ALA alone writes and reads conversation text, in `.roboteam/.ala/sessions/<sessionId>.jsonl`; RoboTeam reads it only through ALA's transcript module and keeps its own turn metadata in `.roboteam/sessions/<sessionId>/config.json`. RoboFlow workflow definitions and run metadata are global SQLite records; its logs and final responses remain in the execution folder.
- Session model and effort overrides are passed to ALA through `--model` and `--effort`; `--effort default` clears inherited effort. Executions without overrides read the robot home configuration directly. Never generate an intermediate ALA config file.
- Session skill links live in `.roboteam/sessions/<sessionId>/skills`, alongside `config.json`. Mount them read-only at cwd `.agents/skills` through ALA’s explicit `at` and `expose` folder options; never install robot links into the shared project skill directory. Existing project skills remain available, with robot selections taking precedence only inside their own session.
- Independent CLI conversations run concurrently. Desktop and Browser share exactly one GUI container and queue per robot. A conversation has one execution at a time.
- The current RoboTeam DS specifications are authoritative. Keep numbering contiguous and update HTML and relevant DS files with behavior changes. Re-evaluate main behaviors before updating DS003.
- Imported authoring skills stay documented in their own folders, not as product features.

# Runtime Defaults

Workflow definitions expose `defaultObjective`. Generation captures the original request; manual and legacy definitions derive it from their description or ordinary task prompts without modifying old records on read. Generic default and code-development require explicit run objectives. Resolve an omitted objective from the same saved graph transaction that creates its run snapshot. Empty Cron job objectives inherit the latest workflow default; existing nonempty overrides stay explicit. DS007 owns objective precedence and authoring updates.

Ploinky starts RoboTeam globally with nestedPodman. `server/robot-cli.mjs --robot default` selects the copilot robot. Native accounts come from that robot's home. `/permissions` supports native approval or full access within ALA's sandbox; Pi rejects approval mode. A saved ALA session pins its backend and cwd.

Cron jobs are global SQLite records owned by the RoboTeam service, not host cron entries. Start the scheduler only after runtime observation is attached. Administrator writes use optimistic revisions; scheduled launches use the ordinary RoboFlow path, skip missed occurrences after restart, and never overlap the same job's running or paused execution. Preserve atomic occurrence claims and run linkage. Results default to workspace `cron-jobs-results`, created on save, not on GET. Folder browsing and explicit creation are administrator-only, use relative navigation keys, exclude hidden folders and symlinks, and cannot leave the workspace. Existing explicit working folders retain the ordinary runtime resolver. DS007 owns scheduling details.

Manual Run now shares scheduled execution claims and run linkage, requires an administrator and the current job revision, and never overlaps pending, running or paused work for the same job. It resets enabled intervals from the attempt time; daily jobs keep their configured hours. Disabled jobs remain disabled and have no next occurrence. Track manual launches during scheduler shutdown. DS007 owns the run-now API and failure contract.

# Key Paths

- `roboTeamAgent/server/`: robot, GUI, task and CLI lifecycle.
- `roboTeamAgent/copilot/src/`: conversational wrapper, commands, sessions and task observation.
- `roboTeamAgent/IDE-plugins/`: Explorer copilot and RoboTeam actions.
- `roboTeamAgent/docs/`: current documentation and specifications.
- `tests/`, `roboTeamAgent/tests/`, `roboTeamAgent/copilot/tests/`: integration and module tests.
