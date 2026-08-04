#!/bin/sh
test "${HOME:-}" = "/home/agent" \
    && test -x "/home/agent/.local/bin/pi" \
    && test -d "/home/agent/.local/lib/node_modules/@earendil-works/pi-coding-agent"
