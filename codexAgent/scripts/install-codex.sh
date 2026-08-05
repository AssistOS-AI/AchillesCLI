#!/bin/sh
set -eu

if [ -z "${HOME:-}" ]; then
    echo "install-codex: HOME is required." >&2
    exit 1
fi

INSTALL_PREFIX="$HOME/.local"
PACKAGE_ENTRY="$INSTALL_PREFIX/lib/node_modules/@openai/codex/bin/codex.js"
PACKAGE_MANIFEST="$INSTALL_PREFIX/lib/node_modules/@openai/codex/package.json"
BIN_PATH="$INSTALL_PREFIX/bin/codex"
CODEX_PACKAGE='@openai/codex@0.146.0'
CODEX_INTEGRITY='sha512-yG3sPWNda/2YAIQIDq9MrrjoCTIQ7rxYM5IasrG3VBcuhCLTkgeg/JzqmJq1V98RE4MJ5jCxDXXQlOjrditFRw=='

mkdir -p "$INSTALL_PREFIX/bin"
if [ -z "${NPM_CLI:-}" ]; then
    for candidate in \
        /opt/ploinky-node/lib/node_modules/npm/bin/npm-cli.js \
        /opt/ploinky-node/share/nodejs/npm/bin/npm-cli.js \
        /usr/local/lib/node_modules/npm/bin/npm-cli.js \
        /usr/share/nodejs/npm/bin/npm-cli.js
    do
        if [ -f "$candidate" ]; then
            NPM_CLI="$candidate"
            break
        fi
    done
fi
if [ -z "${NPM_CLI:-}" ] || [ ! -f "$NPM_CLI" ]; then
    echo "install-codex: npm CLI was not found in the container or bwrap Node runtime." >&2
    exit 1
fi
OBSERVED_INTEGRITY="$(node "$NPM_CLI" view "$CODEX_PACKAGE" dist.integrity --json)"
if [ "$OBSERVED_INTEGRITY" != "$CODEX_INTEGRITY" ] \
    && [ "$OBSERVED_INTEGRITY" != "\"$CODEX_INTEGRITY\"" ]; then
    echo "install-codex: registry integrity does not match the pinned artifact." >&2
    exit 1
fi
node "$NPM_CLI" install -g --prefix "$INSTALL_PREFIX" --ignore-scripts --min-release-age=0 --no-fund --no-audit --loglevel=error --progress=false "$CODEX_PACKAGE"

if [ ! -f "$PACKAGE_ENTRY" ]; then
    echo "install-codex: package entry was not installed at $PACKAGE_ENTRY." >&2
    exit 1
fi
if ! OBSERVED_PACKAGE_ID="$(node -e '
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (typeof manifest.name !== "string" || typeof manifest.version !== "string") process.exit(1);
process.stdout.write(`${manifest.name}@${manifest.version}`);
' "$PACKAGE_MANIFEST")"; then
    echo "install-codex: installed package metadata does not match the pinned version." >&2
    exit 1
fi
if [ "$OBSERVED_PACKAGE_ID" != "$CODEX_PACKAGE" ]; then
    echo "install-codex: installed package metadata does not match the pinned version." >&2
    exit 1
fi

rm -f "$BIN_PATH"
cat > "$BIN_PATH" <<'EOF'
#!/bin/sh
set -eu

if [ -n "${PLOINKY_TASK_BROKER_URL:-}" ] || [ -n "${PLOINKY_TASK_BROKER_KEY:-}" ]; then
    if [ -z "${PLOINKY_TASK_BROKER_URL:-}" ] || [ -z "${PLOINKY_TASK_BROKER_KEY:-}" ]; then
        echo "codex: the scoped task broker capability is incomplete." >&2
        exit 1
    fi
    case "$PLOINKY_TASK_BROKER_URL" in
        http://127.0.0.1:*/v1) ;;
        *)
            echo "codex: the scoped task broker URL is invalid." >&2
            exit 1
            ;;
    esac
    exec node "$HOME/.local/lib/node_modules/@openai/codex/bin/codex.js" \
        --config 'model_provider="ploinky_soul"' \
        --config 'model_providers.ploinky_soul.name="Ploinky Soul Gateway"' \
        --config "model_providers.ploinky_soul.base_url=\"$PLOINKY_TASK_BROKER_URL\"" \
        --config 'model_providers.ploinky_soul.env_key="PLOINKY_TASK_BROKER_KEY"' \
        --config 'model_providers.ploinky_soul.wire_api="responses"' \
        --config 'model_providers.ploinky_soul.requires_openai_auth=false' \
        --config 'shell_environment_policy.ignore_default_excludes=false' \
        --config 'model="gpt-5.6-sol"' \
        "$@"
fi
exec node "$HOME/.local/lib/node_modules/@openai/codex/bin/codex.js" "$@"
EOF
chmod +x "$BIN_PATH"
