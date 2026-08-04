#!/bin/sh
test "${HOME:-}" = "/home/agent" \
    && test -x "$HOME/.opencode/bin/opencode" \
    && test -r "$HOME/.config/opencode/opencode.json" \
    && test -x /opt/ploinky-node/bin/node \
    && test -x /usr/local/libexec/ploinky-bwrap-launch
