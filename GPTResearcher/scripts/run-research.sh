#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/runtime-paths.sh"
exec "$VENV_DIR/bin/python" "$SCRIPT_DIR/start-research.py" "$@"
