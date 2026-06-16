# Launch PI

Delegate a natural-language task to the agent `piAgent`.
Use when PI is mentioned to execute a task in the current project.

## Input Format
Accepts plain prompt text describing the task.

Optionally accepts an explicit model using:

`model: <model> task: <task text>`

The input may also be JSON containing `prompt` or `task` and an optional `model`
override. If no model is provided, the skill uses its default PI model.

## Output Format
Returns plain text. Successful runs return `PI task completed.` and, when PI
produced bounded final output, append that output after a blank line.
Failed runs return the agent error text or an MCP failure message.

When `piAgent.execute-task` queues an async MCP task, the skill polls the returned
task id until completion and forwards bounded log-tail updates through the runtime
progress writer when one is available.
