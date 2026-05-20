# AKU + Copilot Local Smoke Handoff

Date: 2026-05-20

Audience: the next debugging session.

## Goal

Continue debugging the local AchillesCLI Copilot + AKU + research-provider launcher path after a fresh local Explorer deployment and a headless browser smoke test.

The original failing behavior was specific:

- AKU works through WebChat in a headless browser.
- Copilot web-search routing does not satisfy the new semantic-provider contract.
- Literal provider-looking text such as `@web-search ...` incorrectly triggers the placeholder launcher in the current local runtime.

Follow-up code changes after the root-cause report now address the
skill-discovery and placeholder-guard portions of this failure. A fresh runtime
smoke still needs to be rerun from the updated AchillesCLI commit after these
changes are committed/pushed and deployed into the test workspace.

## Critical Invariants

Preserve these while debugging:

1. Search provider agents are self-contained. `webSearchAgent` must not know about, depend on, or call Soul Gateway.
2. Ploinky framework code must not hardcode specific provider agents, tags, backend names, or agent-owned MCP tool names.
3. Provider availability is determined by launcher skills and provider deployment, not by a special `ploinky enable research` command.
4. Provider-looking `@...` text in Copilot chat is ordinary text. It must not dispatch a provider by itself.
5. Request-time LLM inference must go through `achillesAgentLib`.
6. AKU access from AchillesCLI must go through `AkuMemoryAdapter` and public `AgenticKnowledgeUnits` APIs. Do not read or write `.aku` internals directly.

## Repos And Current Commits

Main workspace: `/Users/danielsava/work/file-parser`

Commits that were part of this work and are present in the fresh deployment:

- `AssistOSExplorer/AchillesCLI`: `ce3060d Route Copilot prompts through launcher skills`
- `copilot-agents`: `93cb642 Add semantic Copilot provider launchers`
- Fresh deployed `AchillesIDE`: `6e8b2dc Add LiveKit presence sync and remove old workspace cleanup`

The local Ploinky CLI used for deployment is from:

- `/Users/danielsava/work/file-parser/ploinky`

At handoff time before the follow-up patch, the source subrepos were clean. The top-level `/Users/danielsava/work/file-parser` repository, if treated as a repo, reports the nested subrepos as untracked; ignore that and work inside the relevant subrepo.

## What Changed

### `ploinky`

Committed/pushed earlier in the session:

- Removed the old hardcoded Ploinky/WebChat provider-routing behavior.
- Preserved the invariant that provider routing belongs to agent-owned launcher skills and manifests, not framework code.
- Current local Ploinky HEAD observed during handoff was `421da0f Skip unreachable workspace remotes during update`.

### `AssistOSExplorer/AchillesCLI`

Committed/pushed earlier in the session:

- Added AKU-aware prompt preparation and provider-result cache plumbing around WebChat Copilot turns.
- Added `copilot-router` oskill.
- Added built-in launcher skills:
  - `launch-open-interpreter`
  - `launch-web-search`
- `launch-open-interpreter` is a real relay launcher.
- `launch-web-search` in the AchillesCLI built-in skill tree is still a disabled placeholder:
  - File: `/Users/danielsava/work/file-parser/AssistOSExplorer/AchillesCLI/achilles-cli/src/skills/launch-web-search/src/index.mjs`
  - Its `cskill.md` says "Placeholder launcher for future pure-information web search providers."
  - In browser testing, this placeholder was the one executed.

Important AchillesCLI files:

- `/Users/danielsava/work/file-parser/AssistOSExplorer/AchillesCLI/achilles-cli/src/index.mjs`
- `/Users/danielsava/work/file-parser/AssistOSExplorer/AchillesCLI/achilles-cli/src/skills/copilot-router/oskill.md`
- `/Users/danielsava/work/file-parser/AssistOSExplorer/AchillesCLI/achilles-cli/src/skills/launch-web-search/src/index.mjs`
- `/Users/danielsava/work/file-parser/AssistOSExplorer/AchillesCLI/achilles-cli/src/skills/launch-open-interpreter/src/index.mjs`
- `/Users/danielsava/work/file-parser/AssistOSExplorer/AchillesCLI/achilles-cli/src/lib/akuMemory/AkuMemoryAdapter.mjs`

Uncommitted follow-up patch in this working tree after the browser handoff:

- `achilles-cli/src/index.mjs` now discovers
  `.ploinky/repos/<repo>/achilles-skills` roots generically from Ploinky
  workspace hints and registers them after built-ins/node_modules, allowing a
  deployed launcher to replace a built-in fallback with the same skill name.
- The built-in `launch-web-search` fallback now treats `@web-search` and
  `@search` as ordinary chat text and returns `deprecatedToken: true` without
  implying that the token is an enablement mechanism.
- `tests/copilotRouter.integration.test.mjs` now includes a deployed
  web-search launcher fixture that replaces the placeholder and submits through
  Research Relay, plus a provider-token false-positive case.
- `tests/skillRoots.test.mjs` covers generic Ploinky repo skill-root discovery.
- `tests/launcherWebSearch.test.mjs` covers the fallback launcher guard.
- `docs/specs/DS007-skills-runtime-and-builtins.md` and
  `docs/specs/DS010-ecosystem-integration.md` now describe the repo
  `achilles-skills` discovery contract.

### `copilot-agents`

Committed/pushed earlier in the session:

- Added `webSearchAgent`.
- Added real `achilles-skills/launch-web-search`.
- Added/updated `researchRelay`, `research-agents`, Open Interpreter provider integration, docs, and tests.
- `webSearchAgent` uses a local headless browser service inside its own container.
- `webSearchAgent` does not call Soul Gateway.

Important copilot-agents files:

- `/Users/danielsava/work/file-parser/copilot-agents/webSearchAgent/manifest.json`
- `/Users/danielsava/work/file-parser/copilot-agents/webSearchAgent/server/headless-search-service.mjs`
- `/Users/danielsava/work/file-parser/copilot-agents/webSearchAgent/tools/lib/search-executor.mjs`
- `/Users/danielsava/work/file-parser/copilot-agents/achilles-skills/launch-web-search/src/index.mjs`
- `/Users/danielsava/work/file-parser/copilot-agents/research-agents/manifest.json`
- `/Users/danielsava/work/file-parser/copilot-agents/researchRelay/tools/lib/backends.mjs`
- `/Users/danielsava/work/file-parser/copilot-agents/scripts/smoke/README.md`

## Fresh Local Explorer Deployment

The canonical fresh local deployment instructions are in:

- `/Users/danielsava/work/file-parser/AssistOSExplorer/README.md`

Use this flow for a clean Explorer workspace. Do not pre-enable repos or agents for the normal fresh deployment.

```bash
mkdir -p ~/work/testExplorerFresh
cd ~/work/testExplorerFresh
ploinky destroy || true
find . -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
ploinky start explorer
```

Open:

- Dashboard: `http://127.0.0.1:8080/dashboard`
- Explorer: `http://127.0.0.1:8080/#file-exp/`

Verify:

```bash
cd ~/work/testExplorerFresh
ploinky status
curl -i http://127.0.0.1:8080/health
curl -I http://127.0.0.1:8080/dashboard
```

Expected:

- `/health` returns HTTP 200 and `status: healthy`.
- `/dashboard` returns HTTP 401 without a token. That is expected because dashboard is auth protected.
- `ploinky dashboard` prints a tokenized dashboard URL.

During this session, the README flow successfully:

- destroyed old containers,
- wiped `/Users/danielsava/work/testExplorerFresh`,
- cloned `basic`, `AchillesIDE`, `AchillesCLI`,
- enabled `explorer`,
- started Explorer and dependency agents,
- started router on port `8080`.

## Additional Provider Deployment For Smoke Testing

The default Explorer fresh deploy does not deploy optional `copilot-agents` providers. To test provider routing, I followed the `copilot-agents/scripts/smoke/README.md` path, adjusted to use the local repo checkout:

```bash
cd ~/work/testExplorerFresh
ploinky add repo copilot-agents /Users/danielsava/work/file-parser/copilot-agents
ploinky enable repo copilot-agents
ploinky enable agent copilot-agents/research-agents global
ploinky start explorer 8080
```

Observed wrinkle:

- After enabling only `copilot-agents/research-agents` after Explorer was already running, Ploinky started `research-agents` but did not expand its manifest child agents into the running workspace.
- For the smoke pass, I manually enabled the children listed in `research-agents/manifest.json`:

```bash
cd ~/work/testExplorerFresh
ploinky enable agent copilot-agents/researchRelay global
ploinky enable agent copilot-agents/openInterpreterAgent global
ploinky enable agent copilot-agents/webSearchAgent global
ploinky start explorer 8080
```

First `webSearchAgent` start failed once with:

```text
Container runtime-key probe failed: spawnSync podman ETIMEDOUT
```

Retrying `ploinky start explorer 8080` succeeded.

At handoff time, relevant provider containers were running:

```text
research-agents       127.0.0.1:43052->7000
researchRelay         127.0.0.1:30840->7000
openInterpreterAgent  127.0.0.1:38899->7000
webSearchAgent        127.0.0.1:53411->7000
```

Direct health checks passed:

```bash
curl http://127.0.0.1:43052/health
curl http://127.0.0.1:30840/health
curl http://127.0.0.1:38899/health
curl http://127.0.0.1:53411/health
```

Each returned:

```json
{"ok":true,"server":"ploinky-agent-mcp"}
```

## Headless Browser Smoke Setup

The smoke suite lives here:

- `/Users/danielsava/work/file-parser/AssistOSExplorer/tests/smoke`

Setup used:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/tests/smoke
npm ci
npm run install:browsers
```

The smoke README says the default local credentials are:

- `admin` / `admin`
- `user` / `user`

I used Playwright Chromium headless, and reused the smoke helper `signIn()` from:

- `/Users/danielsava/work/file-parser/AssistOSExplorer/tests/smoke/lib/auth.mjs`

WebChat URL tested:

```text
http://127.0.0.1:8080/webchat?agent=achilles-cli&forward-envelope=1&workspace-dir=.
```

## Browser Test Performed

Artifacts:

- `/Users/danielsava/work/testExplorerFresh/.ploinky/test-artifacts/headless-smoke/aku-copilot-1779284883400/results.json`
- `/Users/danielsava/work/testExplorerFresh/.ploinky/test-artifacts/headless-smoke/aku-copilot-1779284883400/00-webchat-loaded.png`
- `/Users/danielsava/work/testExplorerFresh/.ploinky/test-artifacts/headless-smoke/aku-copilot-1779284883400/01-aku-create.png`
- `/Users/danielsava/work/testExplorerFresh/.ploinky/test-artifacts/headless-smoke/aku-copilot-1779284883400/02-aku-resolve.png`
- `/Users/danielsava/work/testExplorerFresh/.ploinky/test-artifacts/headless-smoke/aku-copilot-1779284883400/03-copilot-web-search.png`
- `/Users/danielsava/work/testExplorerFresh/.ploinky/test-artifacts/headless-smoke/aku-copilot-1779284883400/04-provider-token-is-ordinary-chat.png`

Test prompts sent through headless WebChat:

### 1. AKU Create

Prompt:

```text
/exec aku-memory {"operation":"create","metadata":{"ku_name":"Headless Browser KU aku-copilot-1779284883400","ku_type":"research_note","summary":"Created by the headless browser smoke test for AKU/Copilot.","tags":["headless-smoke","aku-copilot-1779284883400"],"keywords":["headless-smoke","aku-copilot-1779284883400","aku-copilot"]}}
```

Result:

- Passed.
- Created `ku_20260520_134807_06eb2760`.
- Response included `"ok": true`.

Note:

- The server response also prepended a welcome/intro sentence before the JSON:

```text
In the testExplorerFresh workspace you can turn image collections into smooth videos...
```

This may be expected intro-skill behavior, but it is noisy for slash command JSON output.

### 2. AKU Resolve

Prompt:

```text
/exec aku-memory {"operation":"resolve","query":"Headless Browser KU aku-copilot-1779284883400","options":{"limit":5}}
```

Result:

- Passed.
- Search returned the created KU and its `ku_initialized` event.
- Response included:
  - `query: "Headless Browser KU aku-copilot-1779284883400"`
  - `total: 2`
  - `ku_id: "ku_20260520_134807_06eb2760"`

### 3. Semantic Copilot Web Search

Prompt:

```text
Search online for the latest Node.js release date. Answer in one concise sentence and cite sources if available.
```

Actual result:

```text
I’m sorry, but I can’t access the web right now to find the latest Node.js release date.
```

Expected result:

- Copilot should select `launch-web-search`.
- `launch-web-search` should submit through `researchRelay.research_task_submit`.
- `webSearchAgent` should execute its local headless browser path, or return a clear local-browser unavailable/configuration message.
- Result should be natural language, with citations when available.

Interpretation:

- The prompt did not appear to launch the real web-search provider.
- This looks like normal LLM answering, not deterministic launcher dispatch.

### 4. Provider Token False Positive

Prompt:

```text
@web-search latest Node.js release
```

Actual result:

```json
{
  "ok": false,
  "backend": "web-search",
  "cacheable": false,
  "result_text": "Web search is not deployed for this Copilot workspace yet. I cannot look up current online information from here.",
  "persistence_hint": {
    "ku_type": "agent.result.web-search",
    "record_result": false,
    "ttl_hint_seconds": null
  },
  "diagnostics": {
    "providerAvailability": "disabled",
    "promptProvided": true
  }
}
```

Expected result:

- `@web-search ...` should be treated as ordinary chat text.
- It must not dispatch `launch-web-search`.

Interpretation:

- The literal provider-looking token incorrectly triggered the built-in placeholder `launch-web-search`.
- This directly violates the new contract.

## Important Observations

### Workspace Skills Were Empty

In the test workspace, these checks returned no installed workspace skills:

```bash
find /Users/danielsava/work/testExplorerFresh/.agents -maxdepth 4 -type f
find /Users/danielsava/work/testExplorerFresh/.ploinky/skills -maxdepth 4 -type f
```

But `copilot-agents` does contain real launchers under:

```text
/Users/danielsava/work/testExplorerFresh/.ploinky/repos/copilot-agents/achilles-skills/launch-open-interpreter
/Users/danielsava/work/testExplorerFresh/.ploinky/repos/copilot-agents/achilles-skills/launch-web-search
```

There is currently no evidence those `achilles-skills` are being installed into AchillesCLI's runtime skill discovery root.

### Built-In `launch-web-search` Is Placeholder

This file is the placeholder that appears to be used at runtime:

```text
/Users/danielsava/work/file-parser/AssistOSExplorer/AchillesCLI/achilles-cli/src/skills/launch-web-search/src/index.mjs
```

The real launcher exists here:

```text
/Users/danielsava/work/file-parser/copilot-agents/achilles-skills/launch-web-search/src/index.mjs
```

Likely debugging question:

- Should AchillesCLI's built-in `launch-web-search` be replaced with the real relay launcher, mirroring `copilot-agents/achilles-skills/launch-web-search`?
- Or should Ploinky/AchillesCLI install/discover `copilot-agents/achilles-skills` when the provider agent is available?

The prior invariant says an agent is available if there is a skill for launching it. That suggests the skill discovery/installation path is the key contract to fix.

### Existing Unit Tests May Mask The Runtime Failure

`AssistOSExplorer/AchillesCLI/tests/copilotRouter.integration.test.mjs` uses a deterministic fake loop and currently asserts that the web-search prompt selects `launch-web-search`, but it also expects the placeholder disabled result:

```js
assert.equal(launcherResult.result.cacheable, false);
assert.equal(launcherResult.result.diagnostics.providerAvailability, 'disabled');
assert.match(launcherResult.result.result_text, /Web search is not deployed/);
```

That test does not cover the deployed provider case.

Add or update integration coverage so that when a real `launch-web-search` skill is discoverable and `researchRelay` exposes a `web-search` backend, the launcher:

- calls `research_relay_list_backends`,
- calls `web_search_status` through provider availability,
- calls `research_task_submit`,
- returns cacheable result metadata,
- persists cacheable `agent.result.web-search` records through `AkuMemoryAdapter`.

### Browser Diagnostics

The browser recorded several `POST /run` 404s and some `net::ERR_ABORTED` entries on WebChat input/MCP requests.

These did not block the AKU test, but they are worth reviewing:

- See `browserEvents` in `/Users/danielsava/work/testExplorerFresh/.ploinky/test-artifacts/headless-smoke/aku-copilot-1779284883400/results.json`

## Suggested Next Debugging Path

1. Reproduce with the same local workspace:

```bash
cd /Users/danielsava/work/testExplorerFresh
curl -i http://127.0.0.1:8080/health
podman ps --filter name=testExplorerFresh
```

2. Verify the runtime skill source that AchillesCLI registers for `launch-web-search`.

Start with:

```bash
rg -n "launch-web-search|discoverSkills|discoverSkillsFromRoot|skillRoot|builtInSkillsDir" \
  /Users/danielsava/work/file-parser/AssistOSExplorer/AchillesCLI/achilles-cli/src
```

3. Compare real vs placeholder launchers:

```bash
diff -u \
  /Users/danielsava/work/file-parser/AssistOSExplorer/AchillesCLI/achilles-cli/src/skills/launch-web-search/src/index.mjs \
  /Users/danielsava/work/file-parser/copilot-agents/achilles-skills/launch-web-search/src/index.mjs
```

4. Decide the contract fix:

- Option A: Mirror the real `launch-web-search` implementation into AchillesCLI built-in skills.
- Option B: Implement runtime discovery/installation of `copilot-agents/achilles-skills` based on provider plugin/manifest metadata.
- Option C: A hybrid where AchillesCLI ships generic launcher stubs that delegate only when the provider skill is installed, but do not let provider-looking `@...` tokens dispatch.

5. Fix false-positive provider tokens.

The literal prompt:

```text
@web-search latest Node.js release
```

must not call `launch-web-search`.

Check both:

- `copilot-router/oskill.md` instructions,
- actual runtime LLM/tool-selection behavior.

If model behavior is too nondeterministic, add a deterministic pre-router guard in AchillesCLI that prevents provider-looking `@...` prompts from entering provider launcher paths, while still allowing ordinary chat responses.

6. Add a browser smoke spec under:

```text
/Users/danielsava/work/file-parser/AssistOSExplorer/tests/smoke/specs/
```

Suggested file:

```text
70-aku-copilot-routing.spec.mjs
```

It should:

- log in,
- open `/webchat?agent=achilles-cli&forward-envelope=1&workspace-dir=.`,
- create a KU with `/exec aku-memory`,
- resolve that KU,
- send a natural web-search prompt,
- assert the result shape,
- send `@web-search ...`,
- assert no provider dispatch result is returned.

7. Add unit/integration tests in AchillesCLI:

- Real web-search launcher test mirroring `launcherOpenInterpreter.test.mjs`.
- Copilot-router test for provider-token false positives, including `@web-search`.
- Provider-present test where `launch-web-search` is active and uses relay MCP tools.

8. Rerun:

```bash
cd /Users/danielsava/work/file-parser/AssistOSExplorer/AchillesCLI
node --test tests/*.test.mjs

cd /Users/danielsava/work/file-parser/copilot-agents
node scripts/validate-manifests.mjs
node --test tests/unit/*.test.mjs

cd /Users/danielsava/work/file-parser/AssistOSExplorer/tests/smoke
SMOKE_BASE_URL=http://127.0.0.1:8080 npm test -- --grep "AKU|Copilot|routing"
```

## Current Runtime State At Handoff

Workspace:

```text
/Users/danielsava/work/testExplorerFresh
```

Router:

```text
http://127.0.0.1:8080
```

Health:

```json
{
  "status": "healthy"
}
```

Relevant containers are running:

```text
ploinky_copilot-agents_research-agents_testExplorerFresh_d8f88a10
ploinky_copilot-agents_researchRelay_testExplorerFresh_d8f88a10
ploinky_copilot-agents_openInterpreterAgent_testExplorerFresh_d8f88a10
ploinky_copilot-agents_webSearchAgent_testExplorerFresh_d8f88a10
```

Useful logs:

```text
/Users/danielsava/work/testExplorerFresh/.ploinky/logs/router.log
/Users/danielsava/work/testExplorerFresh/.ploinky/logs/watchdog.log
```

The successful browser run artifacts are under:

```text
/Users/danielsava/work/testExplorerFresh/.ploinky/test-artifacts/headless-smoke/aku-copilot-1779284883400/
```

## Handoff Summary

The system deploys locally and AKU is operational through WebChat. Optional provider agents can be started and are healthy. The remaining bug is in Copilot launcher selection/discovery:

- Natural search prompts are not reliably routed to the web-search launcher.
- Literal `@web-search` is wrongly routed to the placeholder launcher.
- The real `copilot-agents` launcher is present in the repo but apparently not used by AchillesCLI in the runtime smoke.

Start debugging at AchillesCLI skill discovery and the built-in `launch-web-search` placeholder.
