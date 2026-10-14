#!/bin/sh
# The agent's install step. Its output is also appended to runtime/install.log in the data volume, because Ploinky
# removes the container, and with it the output, when a start fails.
set -u
export SCOUT_DATA_DIR="${SCOUT_DATA_DIR:-/data}"
log_dir="$SCOUT_DATA_DIR/runtime"
mkdir -p "$log_dir"
log="$log_dir/install.log"
status_file="$log_dir/install.status"
rm -f "$status_file"
echo "=== install started $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$log"
{ node /code/scripts/install.mjs; echo $? > "$status_file"; } 2>&1 | tee -a "$log" >&2
status=$(cat "$status_file" 2>/dev/null || echo 1)
echo "=== install finished $(date -u +%Y-%m-%dT%H:%M:%SZ) with exit status $status" >> "$log"
exit "$status"
