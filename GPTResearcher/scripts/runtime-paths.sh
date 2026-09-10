#!/bin/sh
# Shared paths for the provider-owned Python installation.
: "${HOME:?HOME is required}"
case "$HOME" in
    /) echo '[GPTResearcher] HOME must be an agent-owned directory' >&2; exit 1 ;;
    /*) ;;
    *) echo '[GPTResearcher] HOME must be absolute' >&2; exit 1 ;;
esac
# Apply before Python starts, including automatic sitecustomize imports.
# Launchers share writable source checkouts that must stay unchanged.
export PYTHONDONTWRITEBYTECODE=1
RUNTIME_DIR="$HOME/gpt-researcher"
VENV_DIR="$RUNTIME_DIR/venv"
APP_DIR="$RUNTIME_DIR/app"
