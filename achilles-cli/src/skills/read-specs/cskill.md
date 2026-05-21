# Read Specs

## Summary
Read a skill's specs/ files.

## Description
Call this when the user asks about implementation requirements or before changing generation specs for a skill.

## Help
Input: skillName.

## Input Format
Plain text skill name.

Example:
read-specs demo-skill

## Output Format
Returns specs file paths and content, or an error string when no specs/ files exist.

## Constraints
- Use for generated-code requirements, not for descriptor content.
- If no specs exist, report that clearly instead of inventing content.
