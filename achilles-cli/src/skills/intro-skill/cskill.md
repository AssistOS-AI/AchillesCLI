# Intro Skill

## Summary
Generate a short workspace-aware introduction message.

## Description
Use this at Achilles CLI startup to greet the user with a concise introduction that reflects the current workspace and the visible skill catalog.

## Help
Input: JSON with workspace details and a short list of available skills.

## Input Format
JSON object:

```json
{
  "workingDir": "/path/to/workspace",
  "workspaceName": "workspace",
  "skills": [
    {
      "name": "admin-flow-orchestrator",
      "shortName": "admin-flow",
      "type": "orchestrator",
      "description": "Coordinate admin workflows."
    }
  ]
}
```

Example:
{"workspaceName":"admin-workspace","skills":[{"name":"admin-flow-orchestrator","type":"orchestrator","description":"Coordinate admin workflows."}]}

## Output Format
Returns a plain text introduction message suitable for direct display to the user.

## Constraints
- Keep the message short and useful.
- Do not list every skill unless the catalog is very small.
- Do not invent capabilities that are not supported by the provided skill context.
- Do not ask the user to use a specific internal command.
