#!/bin/sh
set -eu

# Everything the agent writes lives in its /data volume (.data/promotionScout in the workspace); /code is read-only.
export SCOUT_DATA_DIR="${SCOUT_DATA_DIR:-/data}"

agent_server_script="${SCOUT_AGENT_SERVER_SCRIPT:-/Agent/server/AgentServer.sh}"
daemon_main="${SCOUT_DAEMON_MAIN:-/code/src/agent/main.mjs}"

# AgentServer serves the MCP tools and the static web interface; the daemon keeps RSSHub running and starts cycles.
sh "$agent_server_script" &
MCP_PID="$!"

node "$daemon_main" &
DAEMON_PID="$!"

cleanup() {
    kill "$DAEMON_PID" "$MCP_PID" 2>/dev/null || true
    wait "$DAEMON_PID" 2>/dev/null || true
    wait "$MCP_PID" 2>/dev/null || true
}
trap 'exit 130' INT
trap 'exit 143' TERM
trap cleanup EXIT

child_exit_status() {
    set +e
    wait "$1"
    child_status="$?"
    set -e
    if [ "$child_status" -eq 0 ]; then
        child_status=1
    fi
    return "$child_status"
}

while :; do
    if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
        echo "promotionScout daemon exited; stopping AgentServer" >&2
        child_exit_status "$DAEMON_PID"
    fi
    if ! kill -0 "$MCP_PID" 2>/dev/null; then
        echo "promotionScout AgentServer exited; stopping daemon" >&2
        child_exit_status "$MCP_PID"
    fi
    sleep 1
done
