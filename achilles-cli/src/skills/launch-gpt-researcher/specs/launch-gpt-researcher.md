# Launch GPTResearcher Specification

## Core Content

The `launch-gpt-researcher` C-Skill delegates a research request to the workspace
`GPTResearcher` agent by calling its `start_research` MCP tool.

The public input is plain research query text or JSON containing `query`,
optional `context`, optional `reportType`, and optional `useLocalDocs`. The
skill maps these to the agent payload as `query`, `context`, `reportType`, and
`useLocalDocs`.

`query` is the main research query used for web research. `context` contains
optional instructions or data for the research task.

The skill always sends the current AchillesCLI working directory as the
GPTResearcher `workingDir`. This is derived from the running AchillesCLI
instance and is not a caller-controlled parameter.

Supported `reportType` values are `research_report`, `resource_report`,
`outline_report`, `custom_report`, `subtopic_report`, and `deep`. Omitted
`reportType` defaults to `research_report`.

`useLocalDocs` controls whether GPTResearcher receives the working directory as
local document context. Missing `useLocalDocs` defaults to local documents
enabled, so the GPTResearcher agent runs hybrid research. `useLocalDocs: false`
runs web-only research.

The skill returns plain text only. Successful runs return
`GPTResearcher task completed.` and append the generated `report` when present.
If no report is present, it falls back to `outputText`, `result`, or the compact
JSON payload. Failed runs return the agent error text or an MCP failure message.

The call path uses `AgentMcpClient` directly via `createAgentClient` and passes
`onTaskUpdate` to `callTool`; polling is handled internally by the MCP client,
with intermediate `logTail` updates emitted as `tool_reason`.
