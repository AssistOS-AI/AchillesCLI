# RoboTeam and coding workers

RoboTeam provides persistent workspace robots for CLI conversations, delegated ALA tasks, and visible Desktop or Browser work. Explorer's **Open Copilot here** opens the ordinary robot named `default`. AchillesCLI is no longer a separate Ploinky agent.

## Start and configure

Enable `AchillesCLI/roboTeamAgent global no-wait` in Ploinky, or start Explorer, which declares that dependency. RoboTeam uses its existing nestedPodman runtime image. No separate copilot image is required.

Open a robot's Desktop from the RoboTeam dashboard and authenticate Codex, OpenCode, or Pi there. The GUI home at `/config` is the same robot home later supplied to ALA. At startup, RoboTeam prepares Codex, OpenCode, Pi, Playwright MCP, computer-use-linux and Supergateway in the shared tool cache in the background. Robot starts reuse these tools. An immediate request may wait for preparation; failures are logged and retried on demand.

```bash
ploinky cli roboTeamAgent --robot default --dir /workspace/project
```

The chat URL is `/webchat?agent=roboTeamAgent&robot=default&workspace-dir=.&forward-envelope=1`. Every robot card also has **Open Chat**.

## Conversations and tasks

A robot owns its home and account configuration. Each conversation owns its cwd, ALA/native session ID, transcript and selected skills. A turn is one execution in that conversation. Independent CLI conversations and Simple tasks may run concurrently on the same robot. One conversation permits one execution at a time.

Desktop and Browser share one GUI container and one FIFO task queue per robot. A mode or cwd change replaces the idle container. Completing a task leaves the GUI available.

Use `/session`, `/session new`, `/session resume <id>`, `/tasks`, `/model`, and `/permissions`. Pi does not support `ask-for-approval` and rejects it. `full-access` still runs inside ALA's Bubblewrap boundary.

The five bundled skills live in `roboTeamAgent/copilot/src/skills`. Their `copilot` skillset is available to every robot, selected automatically only for `default`. Use `/skills` to list allowed sets and skill descriptions, or `/skills use copilot,documents/read-pdf` to select a set and an individual skill. A saved conversation retains its copied catalog on continuation. `/skills use none` clears the selection.

`/exec launch-robot cli analyst: review this project` starts an independent delegated conversation. Desktop and browser variants also return a live Selkies link. Skill scripts use the Ploinky MCP client through the Router. The wrapper observes native task events and keeps logs, final results and continuation controls in WebChat.

Robot histories, logins and settings remain unchanged. The active contracts are in [RoboTeam documentation](roboTeamAgent/docs/index.html).

## Verification

```bash
node tests/run-all.mjs
cd roboTeamAgent
npm test
```

GPTResearcher remains an optional Ploinky worker. Codex, OpenCode and Pi run through ALA inside RoboTeam, not through separate Ploinky agents.
