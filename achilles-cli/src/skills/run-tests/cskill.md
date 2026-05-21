# Run Tests

## Summary
Run existing skill test files.

## Description
Call this when the user asks to run tests, or after generating/updating tests. It runs existing `.tests.mjs` files and reports pass/fail results.

## Help
Input: `run-tests <skillName>`, `run-tests all`, or `run-tests <target> verbose 30000`.

## Input Format
Optional target skill name or `all`, with optional `verbose` and timeout milliseconds.

Example:
run-tests demo-skill verbose 30000

## Output Format
Returns formatted test results with pass/fail counts and failure details.

## Constraints
- This runs existing tests only; use `write-tests` to create tests.
- Use `all` only when broad test execution is requested.
