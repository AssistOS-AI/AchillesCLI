#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/runtime-paths.sh"
UI_PORT=8000

if [ ! -d "$APP_DIR" ]; then
    echo "[GPTResearcher/start] Missing $APP_DIR. Run install first." >&2
    exit 1
fi

cleanup() {
    if [ -n "${GPT_RESEARCHER_UI_PID:-}" ]; then
        kill "$GPT_RESEARCHER_UI_PID" 2>/dev/null || true
        wait "$GPT_RESEARCHER_UI_PID" 2>/dev/null || true
    fi
}
trap cleanup INT TERM EXIT

export PYTHONPATH="/code/scripts${PYTHONPATH:+:$PYTHONPATH}"

cd "$APP_DIR"
"$VENV_DIR/bin/python" -m uvicorn main:app --host 0.0.0.0 --port "$UI_PORT" &
GPT_RESEARCHER_UI_PID=$!
echo "[GPTResearcher/start] GPT Researcher UI started on port $UI_PORT (pid $GPT_RESEARCHER_UI_PID)"

exec sh /Agent/server/AgentServer.sh
