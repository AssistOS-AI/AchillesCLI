#!/bin/sh
set -eu

if [ -z "${HOME:-}" ]; then
    echo "install-codex: HOME is required." >&2
    exit 1
fi

INSTALL_PREFIX="$HOME/.local"
PACKAGE_ENTRY="$INSTALL_PREFIX/lib/node_modules/@openai/codex/bin/codex.js"
BIN_PATH="$INSTALL_PREFIX/bin/codex"

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
node "$NPM_CLI" install -g --prefix "$INSTALL_PREFIX" --ignore-scripts --min-release-age=0 --no-fund --no-audit --loglevel=error --progress=false @openai/codex

if [ ! -f "$PACKAGE_ENTRY" ]; then
    echo "install-codex: package entry was not installed at $PACKAGE_ENTRY." >&2
    exit 1
fi

rm -f "$BIN_PATH"
cat > "$BIN_PATH" <<'EOF'
#!/bin/sh
exec node "$HOME/.local/lib/node_modules/@openai/codex/bin/codex.js" "$@"
EOF
chmod +x "$BIN_PATH"
