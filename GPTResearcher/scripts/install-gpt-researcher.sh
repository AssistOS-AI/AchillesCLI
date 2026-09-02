#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/runtime-paths.sh"
: "${WORKSPACE_PATH:?WORKSPACE_PATH is required}"
mkdir -p "$RUNTIME_DIR"

python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade pip

if [ ! -d "$APP_DIR/.git" ]; then
    rm -rf "$APP_DIR"
    git clone --depth 1 https://github.com/assafelovic/gpt-researcher.git "$APP_DIR"
fi

"$VENV_DIR/bin/python" -m pip install --no-cache-dir -r "$APP_DIR/requirements.txt"
"$VENV_DIR/bin/python" -m pip install --no-cache-dir "$APP_DIR" langchain-mcp-adapters ddgs

mkdir -p "$WORKSPACE_PATH"
mkdir -p "$HOME"

SETTINGS_PATH="$HOME/gpt-researcher-settings.json"
if [ ! -f "$SETTINGS_PATH" ]; then
    cat > "$SETTINGS_PATH" <<'EOF'
{
  "fastLlm": "codex-api/gpt-5.4-mini",
  "smartLlm": "codex-api/gpt-5.5",
  "strategicLlm": "codex-api/gpt-5.4-mini",
  "embedding": "codestral-embed",
  "searchProvider": "searxng"
}
EOF
fi
