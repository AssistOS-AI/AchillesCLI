# Bash

## Summary
Execute shell commands with tiered permission controls.

## Description
Use this when the user asks to run a shell command in the current workspace. Commands are parsed into executable and arguments, classified for risk, and run with `shell: false`. Dangerous commands require explicit confirmation and blocked patterns are refused.

## Help
Input: command text exactly as it should be run, or JSON with `command`.

## Input Format
Plain text command:

```
ls -la /tmp
grep -r "pattern" src/
find . -name "*.js"
rm unwanted-file.txt
git status
```

Example:
bash git status

JSON command:

```json
{"command":"git status"}
```

## Output Format
Returns stdout text. If stderr, non-zero exit code, timeout, or denial occurs, the response includes a readable error or status message.

## Constraints
- Commands execute with `spawnSync` and `shell: false`.
- Blocked destructive patterns are refused.
- Dangerous or caution commands require permission unless bash permissions are skipped.
- Timeout defaults to 30 seconds.
- Output is limited to 1MB.

## Risk Tiers

| Tier | Example Commands | Behavior |
|------|------------------|----------|
| Blocked | rm -rf /, fork bombs | Refused entirely |
| Dangerous | rm, chmod, kill | Red warning, "yes" required |
| Caution | mv, sed -i | Yellow warning, confirmation |
| Normal | ls, cat, grep | Standard permission |
