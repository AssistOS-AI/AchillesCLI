# Launch OpenCode

Delegate a natural-language task to the agent `opencodeAgent` / opencode. 
Use when opencode/opencodeAgent is mentioned to execute a task

## Input Format
Accepts plain prompt text describing the task.

Optionally accepts an explicit model using:

`model: <model> task: <task text>`

If `model:` is omitted, the skill uses its default OpenCode model.

## Output Format
Returns plain text `Task started.` for asynchronous execution or a completed result for blocking execution; treat both as success.
