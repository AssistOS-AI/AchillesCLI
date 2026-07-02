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

mkdir -p "$WORKSPACE_PATH"

SETTINGS_PATH="$WORKSPACE_PATH/gpt-researcher-settings.json"
if [ ! -f "$SETTINGS_PATH" ]; then
    cat > "$SETTINGS_PATH" <<'EOF'
{
  "fastLlm": "ollama:llama3.1",
  "smartLlm": "ollama:llama3.1",
  "strategicLlm": "ollama:llama3.1",
  "embedding": "ollama:nomic-embed-text",
  "retriever": "duckduckgo",
  "env": {
    "OLLAMA_BASE_URL": "http://host.containers.internal:11434",
    "OPENAI_BASE_URL": "",
    "AZURE_OPENAI_ENDPOINT": "",
    "AZURE_OPENAI_API_VERSION": "",
    "MISTRAL_BASE_URL": "",
    "OPENROUTER_LIMIT_RPS": "",
    "VLLM_OPENAI_API_BASE": "",
    "AIMLAPI_BASE_URL": "",
    "SOUL_GATEWAY_BASE_URL": ""
  }
}
EOF
fi
