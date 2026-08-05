#!/bin/sh
test -n "${HOME:-}" \
    && test -x "$HOME/.local/bin/pi" \
    && node /code/scripts/check-task-sandbox.mjs >/dev/null
