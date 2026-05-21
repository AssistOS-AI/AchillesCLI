# Get Template

## Summary
Return a blank descriptor template for a skill type.

## Description
Call this before creating a new skill when the correct descriptor shape is needed.

## Help
Input: skillType, e.g. tskill, cskill, oskill, mskill.

## Input Format
Plain text skill type such as `tskill`, `cskill`, `oskill`, `mskill`, `dcgskill`, or `anthropic`.

Example:
get-template cskill

## Output Format
Returns the template text and schema metadata, or an error string listing supported types.

## Constraints
- Do not invent template types.
- Use the returned template as a starting point, not as final content without adapting it to the user's request.
