# Execute Skill

## Summary
Execute a registered AchillesAgentLib skill directly.

## Description
Call this only when the user asks to run a specific skill directly. Pass the skill name followed by optional input text for that skill.

## Help
Input: skillName plus optional skillInput text.

## Input Format
Plain text in the form `<skillName> [skillInput]`, or JSON with `skillName`/`name` and optional `input`/`skillInput`.

Example:
execute-skill demo-skill hello

## Output Format
Returns the executed skill result, or an error string when the skill cannot be found or execution fails.

## Constraints
- Do not use this for normal planning when another specialized skill should be selected.
- Preserve the user's intended skill input without rewriting it unnecessarily.
