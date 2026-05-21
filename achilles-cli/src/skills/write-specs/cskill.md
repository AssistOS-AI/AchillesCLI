# Write Specs

## Summary
Create or replace a skill specs/ file.

## Description
Call this to create or replace a skill's generation specs under `specs/`. Use it for cskill/generated-code workflows where implementation requirements must be explicit.

## Help
Input: `write-specs <skillName> [fileName] --begin-content--` followed by specs content and `--end-content--`. Use `write-specs <skillName>` to create the default specs template.

## Input Format
Skill name, optional specs file name, and optional trailing content block. Defaults to `specs/index.mjs.md` for cskill and `specs/tskill.generated.mjs.md` for tskill/dbtable.

Example:
write-specs demo-skill index.mjs.md --begin-content--
Return the string "hello" for every invocation.
--end-content--

## Output Format
Returns a created/updated specs message with the written path, or an error string.

## Constraints
- Specs should describe implementation requirements, not user-facing descriptor routing only.
- Validate/generate after specs changes when runtime code depends on them.
