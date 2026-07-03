# Launch GPTResearcher

Delegate a research task to the `GPTResearcher` Ploinky agent.
Use when GPTResearcher or GPT Researcher is mentioned to produce a researched report.

## Input Format
Accepts plain prompt text describing the research question.

The input may also be JSON containing:

- `prompt`: research question, required.
- `context`: additional context or instructions, optional.
- `reportType`: GPT Researcher report type, optional. Defaults to the agent default.
- `workingDir`: optional directory. If omitted, the skill uses the current
  AchillesCLI working directory. Files in this directory are provided as local
  context and the report is saved there.

## Output Format
Returns plain text. Successful runs return `GPTResearcher task completed.` and
append the report when available. Failed runs return the agent error text or an
MCP failure message.
