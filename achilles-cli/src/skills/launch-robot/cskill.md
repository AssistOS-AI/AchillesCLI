# Launch Robot

## Description
Start a visible RoboTeam Desktop or Browser task for one robot in the current AchillesCLI workspace. Use when the user names a robot, requests desktop or browser work, and wants a live Selkies link.

## Input Format
Use `desktop <robot name>: <task>` or `browser <robot name>: <task>`. A JSON object with `mode`, `robotName`, `task`, and optional `ca`, `model`, or `skillSets` is also accepted.

## Output Format
Plain text containing the task id and a Markdown link to the live Selkies session after the GUI and its MCP bridge are ready.

## Constraints
Only `desktop` and `browser` modes are accepted. The task always uses the active AchillesCLI workspace as `cwd`. Calls use RoboTeam's internal workspace-agent tools through the Ploinky Router.

## Help
Example: `desktop analyst: inspect the application and prepare a usability report`.
