#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ -z "${HOME:-}" ]; then
    echo "PLOINKY_PROVIDER_HOME_UNAVAILABLE: OpenCode readiness requires the selected service HOME." >&2
    exit 1
fi

"$SCRIPT_DIR/scripts/ensure-bubblewrap.sh"

if ! command -v node >/dev/null 2>&1 \
    || ! test -x "$HOME/.opencode/bin/opencode" \
    || ! test -r "$HOME/.config/opencode/opencode.json"
then
    echo "PLOINKY_PROVIDER_CAPABILITY_UNAVAILABLE: OpenCode is not installed in the selected service HOME." >&2
    exit 1
fi
