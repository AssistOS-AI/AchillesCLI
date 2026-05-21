# Delete Skill

## Summary
Delete an AchillesCLI skill directory.

## Description
Call this only after the user explicitly asks to delete a skill. It removes the complete skill directory, including descriptor files, generated code, specs, and tests.

## Help
Input: skillName.

## Input Format
Plain text skill name.

Example:
delete-skill demo-skill

## Output Format
Returns a success message naming the deleted skill, or an error string explaining why deletion failed.

## Constraints
- Do not call this for ambiguous delete requests.
- The delete operation is irreversible outside version control.
