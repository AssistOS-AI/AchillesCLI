# Launch OpenCode Specification

## Core Content

The `launch-opencode` C-Skill delegates a plain natural-language task to the
workspace `opencodeAgent` by calling its `execute-task` MCP tool. The public
input is task text only. The agent name is intentionally not part of the public
grammar because OpenCode is a named provider launcher, not a generic
agent-dispatch utility.

The skill maps the task text into the `prompt` argument required by
`opencodeAgent.execute-task`. It resolves `projectDir` from
`invocation.mainAgent.startDir`, which is the AchillesCLI session working
directory, and uses the hardcoded model
`xai/grok-4.20-0309-non-reasoning`. The resulting MCP payload must contain
`prompt`, `projectDir`, and `model`.

The skill returns plain text only. Successful runs return
`OpenCode task completed.` Failed runs return the agent error text or an MCP
failure message.

The call path must remain Ploinky-mediated. When the runtime has agent
credentials and the bundled Ploinky agent client is available, the skill uses
that native client so Agent Assertion and router MCP policy authorize the
operation. When running from WebChat context without direct agent-client
access, it falls back to AchillesCLI's invocation-token MCP helper.

## Decisions & Questions

1. The skill is named `launch-opencode` to match the existing
   `launch-open-interpreter` and `launch-web-search` provider-launcher pattern.
2. `opencodeAgent` is fixed internally for this version. A future generic
   agent caller would be a separate skill with a different security contract.
3. The model is hardcoded to `xai/grok-4.20-0309-non-reasoning` so the launcher
   behavior is stable and does not depend on session or environment model
   configuration.
