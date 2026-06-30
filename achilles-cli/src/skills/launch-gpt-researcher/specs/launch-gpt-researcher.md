# Launch GPTResearcher Specification

## Core Content

The `launch-gpt-researcher` C-Skill delegates a research request to the workspace
`GPTResearcher` agent by calling its `start_research` MCP tool.

The public input is plain research prompt text or JSON containing `prompt`,
optional `context`, and optional `reportType`. The skill maps these to the agent
payload as `query`, `moreContext`, and `reportType`.

The skill returns plain text only. Successful runs return
`GPTResearcher task completed.` and append the generated `report` when present.
If no report is present, it falls back to `outputText`, `result`, or the compact
JSON payload. Failed runs return the agent error text or an MCP failure message.

The call path uses `AgentMcpClient` directly via `createAgentClient` and passes
`onTaskUpdate` to `callTool`; polling is handled internally by the MCP client,
with intermediate `logTail` updates emitted as `tool_reason`.
