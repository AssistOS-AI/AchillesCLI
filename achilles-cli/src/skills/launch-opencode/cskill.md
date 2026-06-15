# Launch OpenCode

Delegate a natural-language task to the agent `opencodeAgent` / opencode. 
Use when opencode/opencodeAgent is mentioned to execute a task

## Input Format
Accepts plain prompt text describing the task.

## Output Format
Returns plain text. Successful runs return `OpenCode task completed.` and, when
OpenCode produced bounded final output, append that output after a blank line.
Failed runs return the agent error text or an MCP failure message.

When `opencodeAgent.execute-task` queues an async MCP task, the skill polls the
returned task id until completion and forwards bounded log-tail updates through
the runtime progress writer when one is available.

The skill must call `opencodeAgent` through Ploinky `AgentMcpClient` using the
router paths `/<agent>/mcp` and `/<agent>/task`. It must not use the legacy
AchillesCLI MCP helper.
