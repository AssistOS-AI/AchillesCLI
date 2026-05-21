# Preview Changes

## Summary
Preview a proposed full-file skill change.

## Description
Call this before applying a large full-file replacement when the user wants review or the change is risky.

## Help
Input: `preview-changes <skillName> <fileName> --begin-content--` followed by the proposed file content and `--end-content--`.

## Input Format
Skill name, file name, and a trailing proposed content block.

Example:
preview-changes demo-skill cskill.md --begin-content--
# Demo Skill

## Description
Outputs hello.
--end-content--

## Output Format
Returns a diff-like preview, or an error string when the target file cannot be read.

## Constraints
- Use for previews only; this skill must not write changes.
- Prefer `update-section` for focused section edits.
