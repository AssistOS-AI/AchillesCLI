#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
"$SCRIPT_DIR/ensure-bubblewrap.sh"

if [ -z "${HOME:-}" ]; then
    echo "install-pi: HOME is required." >&2
    exit 1
fi

INSTALL_PREFIX="$HOME/.local"
PACKAGE_ENTRY="$INSTALL_PREFIX/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js"
PACKAGE_MANIFEST="$INSTALL_PREFIX/lib/node_modules/@earendil-works/pi-coding-agent/package.json"
BIN_PATH="$INSTALL_PREFIX/bin/pi"
PI_PACKAGE='@earendil-works/pi-coding-agent@0.83.0'

mkdir -p \
    "$INSTALL_PREFIX/bin" \
    "$HOME/.pi/agent" \
    "$HOME/.ploinky/pi-sessions" \
    "$HOME/.ploinky/task-sessions"
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
    echo "install-pi: npm CLI was not found in the container or bwrap Node runtime." >&2
    exit 1
fi
node "$NPM_CLI" install -g --prefix "$INSTALL_PREFIX" --ignore-scripts --min-release-age=0 --no-fund --no-audit --loglevel=error --progress=false "$PI_PACKAGE"

if [ ! -f "$PACKAGE_ENTRY" ]; then
    echo "install-pi: package entry was not installed at $PACKAGE_ENTRY." >&2
    exit 1
fi
if ! OBSERVED_PACKAGE_ID="$(node -e '
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (typeof manifest.name !== "string" || typeof manifest.version !== "string") process.exit(1);
process.stdout.write(`${manifest.name}@${manifest.version}`);
' "$PACKAGE_MANIFEST")"; then
    echo "install-pi: installed package metadata does not match the pinned version." >&2
    exit 1
fi
if [ "$OBSERVED_PACKAGE_ID" != "$PI_PACKAGE" ]; then
    echo "install-pi: installed package metadata does not match the pinned version." >&2
    exit 1
fi

rm -f "$BIN_PATH"
cat > "$BIN_PATH" <<'EOF'
#!/bin/sh
exec node "$HOME/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/cli.js" "$@"
EOF
chmod +x "$BIN_PATH"
