# Scope

RoboTeam is the workspace robot and copilot agent. The conversational runtime lives in `roboTeamAgent/copilot/`; GPTResearcher remains a separate optional research worker.

# Mandatory Reading Order

Read `README.md`, `roboTeamAgent/docs/index.html`, `roboTeamAgent/docs/wiki.html`, the specification matrix and relevant DS files before changing behavior. `roboTeamAgent/docs/specs/DS001-coding-style.md` owns coding style. For conversational internals, inspect `roboTeamAgent/copilot/src/index.mjs`, `server/robot-cli.mjs`, and their tests.

# Current Skill Catalog

The bundled `copilot` skillset contains five self-contained Anthropic skills under `roboTeamAgent/copilot/src/skills/`: bash, launch-gpt-researcher, launch-open-interpreter, launch-web-search, and launch-robot. Robot discovery is a launch-robot script, not a sixth skill. Keep this catalog and RoboTeam documentation synchronized.

# Repository Rules

- Use English for source comments and documentation, ES modules and four-space JavaScript indentation.
- ALA owns coding-agent selection, native sessions and Bubblewrap execution. Do not restore MainAgent or the retired Bash broker as the conversational engine.
- Skills call the real Ploinky MCP client through the Router. Never introduce a parallel MCP bridge or forward master/user-session credentials.
- Robot homes and copilot state are robot-scoped. Do not migrate or delete old AchillesCLI data.
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
