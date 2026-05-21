# Update Section

## Summary
Add or replace one section in a skill descriptor.

## Description
Call this to add or replace exactly one Markdown section in an existing skill descriptor. Prefer this over full-file writes for focused edits.

## Help
Input: `update-section <skillName> <section> --begin-content--` followed by the section content and `--end-content--`.

## Input Format
Skill name, section name, and a trailing content block.

Example:
update-section demo-skill Description --begin-content--
Outputs hello.
--end-content--

## Output Format
Returns a success message with the updated section, or an error string.

## Constraints
- Only update one section per call.
- Read the skill first when preserving surrounding content matters.
