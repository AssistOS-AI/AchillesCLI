# Bash

## Summary
Execute a command through the Achilles Broker.

## Description
Use this when the user asks to run a shell command. The skill only parses the executable and arguments and delegates execution to the Achilles Broker. Permission mode, user approval, workspace confinement, and escalation are controlled by the external Supervisor and `/permissions`.

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
Returns stdout text. If stderr, non-zero exit code, timeout, pending approval, or denial occurs, the response includes a readable status message.

## Constraints
- The skill contains no approval prompts, risk classifier, allowlist, or denial memory.
- Commands execute without a shell; pipes, redirections, and shell operators are not interpreted.
- Glob expansion is applied before the structured command is sent to the Broker.
- The Broker is mandatory and fails closed when unavailable.
- `/permissions` controls only Bash execution; other skills are unaffected.
