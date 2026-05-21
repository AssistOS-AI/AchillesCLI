# Write Tests

## Summary
Generate broader test files for supported skill types.

## Description
Call this when a supported generated runtime skill needs a broader test file. It generates tests for `tskill`/`dbtable` and `cskill`.

## Help
Input: `write-tests <skillName>` or `write-tests <skillName> force`.

## Input Format
Skill name, with optional `force` to overwrite an existing test file.

Example:
write-tests demo-skill force

## Output Format
Returns a generated test file summary, or an error string.

## Constraints
- Use this skill for all supported generated runtime test creation, including cskill tests derived from specs.
- Run tests after writing them when verification is requested.
