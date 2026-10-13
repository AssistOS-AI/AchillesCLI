#!/bin/sh
set -eu
export SCOUT_DATA_DIR="${SCOUT_DATA_DIR:-/data}"
exec node /code/scripts/install.mjs
