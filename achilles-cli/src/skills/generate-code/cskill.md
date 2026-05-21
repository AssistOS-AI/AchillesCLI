# Generate Code

## Summary
Generate runtime JavaScript for supported skill descriptors.

## Description
Call this after creating or changing a skill descriptor that needs runtime JavaScript. It generates code for supported generated skill types: `tskill`/`dbtable` and `cskill`.

## Help
Input: skillName to generate code for.

## Input Format
Plain text skill name.

Example:
generate-code demo-skill

## Output Format
Returns a generation summary with output paths and optional test results, or an error string.

## Constraints
- Use after descriptor/spec changes for generated skill types.
- Do not use for `oskill`, `mskill`, `dcgskill`, or `anthropic`; agentLib executes those through their own subsystems.
