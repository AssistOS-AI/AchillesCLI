# Write Skill

## Summary
Create or replace a skill file.

## Description
Call this to create a new skill descriptor or replace a full skill file. It creates the skill directory when missing.

## Help
Input: `write-skill <skillName> <fileName> --begin-content--` followed by the full file content and `--end-content--`.

## Input Format
Skill name, file name, and a trailing content block.

Example:
write-skill demo-skill cskill.md --begin-content--
# Demo Skill

## Description
Outputs hello.
--end-content--

## Output Format
Returns a created/updated message with byte count, or an error string.

## Constraints
- Use `update-section` instead for focused descriptor section changes.
- The `fileName` must be a recognized skill descriptor or JavaScript module file.
