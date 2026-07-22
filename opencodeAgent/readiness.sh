#!/bin/sh
test -n "${HOME:-}" \
    && test -x "$HOME/.opencode/bin/opencode" \
    && test -r "$HOME/.config/opencode/opencode.json"
