#!/bin/sh
set -eu

VENV_DIR=/opt/gpt-researcher-venv
APP_DIR=/opt/gpt-researcher-app
UI_PORT=8000

if [ ! -d "$APP_DIR" ]; then
    echo "[GPTResearcher/start] Missing $APP_DIR. Run install first." >&2
    exit 1
fi

cleanup() {
    if [ -n "${GPT_RESEARCHER_AGENT_PID:-}" ]; then
        kill "$GPT_RESEARCHER_AGENT_PID" 2>/dev/null || true
        wait "$GPT_RESEARCHER_AGENT_PID" 2>/dev/null || true
    fi
    if [ -n "${GPT_RESEARCHER_UI_PID:-}" ]; then
        kill "$GPT_RESEARCHER_UI_PID" 2>/dev/null || true
        wait "$GPT_RESEARCHER_UI_PID" 2>/dev/null || true
    fi
}
trap cleanup INT TERM EXIT

export PYTHONPATH="/code/scripts:$APP_DIR${PYTHONPATH:+:$PYTHONPATH}"

cd "$APP_DIR"
"$VENV_DIR/bin/python" -m uvicorn gpt_researcher_base_path:app --host 0.0.0.0 --port "$UI_PORT" &
GPT_RESEARCHER_UI_PID=$!
echo "[GPTResearcher/start] GPT Researcher private Router target started on port $UI_PORT/services/gpt-researcher/ (pid $GPT_RESEARCHER_UI_PID)"

sh /Agent/server/AgentServer.sh &
GPT_RESEARCHER_AGENT_PID=$!

while kill -0 "$GPT_RESEARCHER_UI_PID" 2>/dev/null \
    && kill -0 "$GPT_RESEARCHER_AGENT_PID" 2>/dev/null; do
    sleep 1
done

echo "[GPTResearcher/start] A supervised process exited unexpectedly." >&2
exit 1
