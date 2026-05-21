# Validate Skill

## Summary
Validate a skill descriptor against its schema.

## Description
Call this after creating or changing a skill descriptor, or when the user asks whether a skill is valid.

## Help
Input: skillName.

## Input Format
Plain text skill name.

Example:
validate-skill demo-skill

## Output Format
Returns validation status, errors, warnings, and detected skill type.

## Constraints
- Validate after descriptor edits before generating code or tests.
- Validation checks descriptor shape; it does not prove runtime behavior.
