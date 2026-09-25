# Scope

RoboTeam is the workspace robot and copilot agent. The conversational runtime lives in `roboTeamAgent/copilot/`; GPTResearcher remains a separate optional research worker.

# Mandatory Reading Order

Read `README.md`, `roboTeamAgent/docs/index.html`, `roboTeamAgent/docs/wiki.html`, the specification matrix and relevant DS files before changing behavior. `roboTeamAgent/docs/specs/DS001-coding-style.md` owns coding style. For conversational internals, inspect `roboTeamAgent/copilot/src/index.mjs`, `server/robot-cli.mjs`, and their tests.

# Current Skill Catalog

The bundled `copilot` repository contains three self-contained Anthropic skills under `roboTeamAgent/copilot/src/skills/`: bash, launch-gpt-researcher, and launch-workflow. Its only skillset is `copilot` (bash and launch-gpt-researcher); `launch-workflow` is an individual skill. The default robot automatically mounts all three, and the front copilot uses `launch-workflow`. The builtin copilot repository is available only to the default robot. Workflow tasks mount their selected skillsets or, for repositories without declared skillsets, individual skills. RoboFlow owns directed graph execution and chooses robots by matching those selections. The caller supplies system instructions for conversations, generation and branching tasks. Keep this catalog and RoboTeam documentation synchronized.

# Repository Rules

- Use English for source comments and documentation, ES modules and four-space JavaScript indentation.
- ALA owns coding-agent selection, native sessions and Bubblewrap execution. Do not restore MainAgent or the retired Bash broker as the conversational engine.
- Skills call the real Ploinky MCP client through the Router. Never introduce a parallel MCP bridge or forward master/user-session credentials.
- Robot homes and native accounts are robot-scoped. Copilot conversations and native task history belong to the opened folder under `.achilles-cli/`. RoboFlow workflow definitions and run metadata are global SQLite records; its logs and final responses remain in the execution folder.
- Independent CLI conversations run concurrently. Desktop and Browser share exactly one GUI container and queue per robot. A conversation has one execution at a time.
- The current RoboTeam DS specifications are authoritative. Keep numbering contiguous and update HTML and relevant DS files with behavior changes. Re-evaluate main behaviors before updating DS003.
- Imported authoring skills stay documented in their own folders, not as product features.

# Runtime Defaults

Ploinky starts RoboTeam globally with nestedPodman. `server/robot-cli.mjs --robot default` selects the copilot robot. Native accounts come from that robot's home. `/permissions` supports native approval or full access within ALA's sandbox; Pi rejects approval mode. A saved ALA session pins its backend and cwd.

# Key Paths

- `roboTeamAgent/server/`: robot, GUI, task and CLI lifecycle.
- `roboTeamAgent/copilot/src/`: conversational wrapper, commands, sessions and task observation.
- `roboTeamAgent/IDE-plugins/`: Explorer copilot and RoboTeam actions.
- `roboTeamAgent/docs/`: current documentation and specifications.
- `tests/`, `roboTeamAgent/tests/`, `roboTeamAgent/copilot/tests/`: integration and module tests.
