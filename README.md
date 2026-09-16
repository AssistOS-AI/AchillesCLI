# RoboTeam and coding workers

RoboTeam provides persistent workspace robots for CLI conversations, delegated ALA tasks, and visible Desktop or Browser work. Explorer's **Open Copilot here** opens the ordinary robot named `default`. AchillesCLI is no longer a separate Ploinky agent.

## Start and configure

Enable `AchillesCLI/roboTeamAgent global no-wait` in Ploinky, or start Explorer, which declares that dependency. RoboTeam uses its existing nestedPodman runtime image. No separate copilot image is required.

Open a robot's Desktop from the RoboTeam dashboard and authenticate Codex, OpenCode, or Pi there. The GUI home at `/config` is the same robot home later supplied to ALA. At startup, RoboTeam prepares Codex, OpenCode, Pi, Playwright MCP, computer-use-linux and Supergateway in the shared tool cache in the background. Robot starts reuse these tools. An immediate request may wait for preparation; failures are logged and retried on demand.

```bash
ploinky cli roboTeamAgent --robot default --dir /workspace/project
```

The chat URL is `/webchat?agent=roboTeamAgent&robot=default&workspace-dir=.&forward-envelope=1`. Every robot card also has **Open Chat**.

RoboTeam installs a shared Soul Gateway plugin in every robot's global OpenCode plugins directory. At native OpenCode initialization, the plugin discovers the local gateway's models and adds them to the in-memory provider configuration. Manual terminal launches, WebChat's model selector and ALA execution use the same plugin. No generated `opencode.json`, model list or periodic polling is required. Manage upstream accounts once in Soul Gateway. Selecting the robot's coding backend remains a separate setting. See [Soul Gateway models](roboTeamAgent/docs/operations.html#soul-gateway-models).

ALA is provided through `link-install`: Ploinky clones `https://github.com/AssistOS-AI/AdvancedLanguageAgent.git` into the workspace only when no matching checkout exists. `/Agent/linked/AdvancedLanguageAgent` links to that editable checkout. Existing clones and local edits are preserved; there is no automatic pull. RoboTeam no longer installs ALA through npm.

## Conversations and tasks

A robot owns its home and account configuration. Each conversation owns its cwd, ALA/native session ID, transcript and selected skills. A turn is one execution in that conversation. Independent CLI conversations and Simple tasks may run concurrently on the same robot. One conversation permits one execution at a time.

Desktop and Browser share one GUI container and one FIFO task queue per robot. A mode or cwd change replaces the idle container. Completing a task leaves the GUI available.

Use `/session`, `/session new`, `/session resume <id>`, `/tasks`, `/model`, and `/permissions`. Pi does not support `ask-for-approval` and rejects it. `full-access` still runs inside ALA's Bubblewrap boundary.

The three bundled skills live in `roboTeamAgent/copilot/src/skills`. Their `copilot` skillset is available only to `default`, where it is selected automatically. Manage repositories in RoboTeam and conversation skill selection in Explorer. A saved conversation captures current configured files before each execution. The CLI uses those skills but does not list, add, remove, reload or change them. Use `/list robots` to discover workspace robots.

`/exec launch-robot cli analyst: review this project` starts an independent delegated conversation. Desktop and browser variants also return a live Selkies link. Skill scripts use the Ploinky MCP client through the Router. The wrapper observes native task events and keeps logs, final results and continuation controls in WebChat.

Robot histories, logins and settings remain unchanged. The active contracts are in [RoboTeam documentation](roboTeamAgent/docs/index.html).

## Verification

```bash
node tests/run-all.mjs
cd roboTeamAgent
node --test tests/*.test.mjs
```

GPTResearcher remains an optional Ploinky worker. Codex, OpenCode and Pi run through ALA inside RoboTeam, not through separate Ploinky agents.

Skill repositories are managed from each robot’s **Manage skills** dialog. Their optional `skillsets.md` defines named combinations with Description and Skills sections. The default copilot receives each robot’s available combinations and delegates using their generated IDs.

See [Skills & Skillsets](roboTeamAgent/docs/skills.html) for repository management, Markdown definitions and the execution catalog flow.

Local instruction skills use live conversation policies and capture current files at execution start. See [local skill discovery](roboTeamAgent/docs/local-skills.html).
