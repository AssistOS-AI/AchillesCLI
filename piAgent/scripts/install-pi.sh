#!/bin/sh
set -eu

if [ -z "${HOME:-}" ]; then
    echo "install-pi: HOME is required." >&2
    exit 1
fi

INSTALL_PREFIX="$HOME/.local"
PACKAGE_ENTRY="$INSTALL_PREFIX/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"
BIN_PATH="$INSTALL_PREFIX/bin/pi"

mkdir -p "$INSTALL_PREFIX/bin"
if [ -n "${NPM_CLI:-}" ]; then
    node "$NPM_CLI" install -g --prefix "$INSTALL_PREFIX" --ignore-scripts --min-release-age=0 --no-fund --no-audit --loglevel=error --progress=false @earendil-works/pi-coding-agent
else
    npm install -g --prefix "$INSTALL_PREFIX" --ignore-scripts --min-release-age=0 --no-fund --no-audit --loglevel=error --progress=false @earendil-works/pi-coding-agent
fi

if [ ! -f "$PACKAGE_ENTRY" ]; then
    echo "install-pi: package entry was not installed at $PACKAGE_ENTRY." >&2
    exit 1
fi

rm -f "$BIN_PATH"
cat > "$BIN_PATH" <<'EOF'
#!/bin/sh
exec node "$HOME/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js" "$@"
EOF
chmod +x "$BIN_PATH"
