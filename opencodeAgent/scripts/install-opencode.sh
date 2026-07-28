#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
CONFIG_TEMPLATE="$SCRIPT_DIR/../opencode.json"

"$SCRIPT_DIR/ensure-bubblewrap.sh"

if [ -z "${HOME:-}" ]; then
    echo "install-opencode: HOME is required." >&2
    exit 1
fi

node -e '
const fs = require("fs");
JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
' "$CONFIG_TEMPLATE"

INSTALLER_PATH=$(mktemp)
TEMP_PATH=
cleanup() {
    if [ -n "$INSTALLER_PATH" ]; then
        rm -f "$INSTALLER_PATH"
    fi
    if [ -n "$TEMP_PATH" ]; then
        rm -f "$TEMP_PATH"
    fi
}
trap cleanup EXIT HUP INT TERM

curl -fsSL https://opencode.ai/install > "$INSTALLER_PATH"
bash "$INSTALLER_PATH"
rm -f "$INSTALLER_PATH"
INSTALLER_PATH=

OPENCODE_BIN="$HOME/.opencode/bin/opencode"
if [ ! -x "$OPENCODE_BIN" ]; then
    echo "install-opencode: installer did not create $OPENCODE_BIN." >&2
    exit 1
fi

CONFIG_DIR="$HOME/.config/opencode"
CONFIG_PATH="$CONFIG_DIR/opencode.json"
mkdir -p \
    "$CONFIG_DIR" \
    "$HOME/.cache/opencode" \
    "$HOME/.local/share/opencode" \
    "$HOME/.local/state/opencode"
chmod 700 "$CONFIG_DIR"

TEMP_PATH=$(mktemp "$CONFIG_DIR/.opencode.json.XXXXXX")
cp "$CONFIG_TEMPLATE" "$TEMP_PATH"
chmod 600 "$TEMP_PATH"
mv -f "$TEMP_PATH" "$CONFIG_PATH"
trap - EXIT HUP INT TERM

echo "install-opencode: installed OpenCode and configured Soul Gateway."
