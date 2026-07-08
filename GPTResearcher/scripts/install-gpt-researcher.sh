#!/bin/sh
set -eu

VENV_DIR=/opt/gpt-researcher-venv
APP_DIR=/opt/gpt-researcher-app

python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install --no-cache-dir gpt-researcher langchain-mcp-adapters ddgs

if [ ! -d "$APP_DIR/.git" ]; then
    rm -rf "$APP_DIR"
    git clone --depth 1 https://github.com/assafelovic/gpt-researcher.git "$APP_DIR"
fi

"$VENV_DIR/bin/python" -m pip install --no-cache-dir -r "$APP_DIR/requirements.txt"

: "${WORKSPACE_PATH:?WORKSPACE_PATH is required}"
: "${HOME:?HOME is required}"

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
  "searchProvider": "duckduckgo"
}
EOF
fi
