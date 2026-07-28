# Bash

## Summary
Execute a command inside MainAgent's existing workspace sandbox.

## Description
Use this when the user asks to run a shell command. The skill only parses the executable and arguments and delegates execution to the local executor inside MainAgent's existing sandbox. Permission mode and user approval are controlled by the external Supervisor and `/permissions`; workspace confinement is inherited from MainAgent.

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
- Glob expansion is applied before the structured command is sent to the local executor.
- The local executor is mandatory and fails closed when unavailable.
- `/permissions` controls only Bash execution; other skills are unaffected.
