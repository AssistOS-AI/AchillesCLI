# List Skills

## Summary
List discovered AchillesAgentLib skills.

## Description
Call this when the user asks what skills exist, asks for skill discovery, or provides an ambiguous skill name.

## Help
Input: optional type filter, or empty for all skills.

## Input Format
Empty input for all skills, or a plain text filter such as a skill type/name fragment.

Example:
list-skills cskill

## Output Format
Returns a formatted skill list with names, types, summaries, and paths.

## Constraints
- Use this for discovery before choosing among ambiguous skill names.
- Do not treat the listing itself as permission to modify skills.
