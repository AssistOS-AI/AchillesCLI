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
Returns plain text "Task started" or "Task completed" depending on the env where the task is executed, treat both as success.
