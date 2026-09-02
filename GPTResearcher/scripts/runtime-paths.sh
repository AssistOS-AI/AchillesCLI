#!/bin/sh
# Shared paths for the provider-owned Python installation.
: "${HOME:?HOME is required}"
case "$HOME" in
    /) echo '[GPTResearcher] HOME must be an agent-owned directory' >&2; exit 1 ;;
    /*) ;;
    *) echo '[GPTResearcher] HOME must be absolute' >&2; exit 1 ;;
esac
RUNTIME_DIR="$HOME/gpt-researcher"
VENV_DIR="$RUNTIME_DIR/venv"
APP_DIR="$RUNTIME_DIR/app"
