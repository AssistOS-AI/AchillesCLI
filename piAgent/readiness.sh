#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ -z "${HOME:-}" ]; then
    echo "PLOINKY_PROVIDER_HOME_UNAVAILABLE: PI readiness requires the selected service HOME." >&2
    exit 1
fi

"$SCRIPT_DIR/scripts/ensure-bubblewrap.sh"

if ! command -v node >/dev/null 2>&1 \
    || ! test -x "$HOME/.local/bin/pi" \
    || ! test -d "$HOME/.local/lib/node_modules/@earendil-works/pi-coding-agent"
then
    echo "PLOINKY_PROVIDER_CAPABILITY_UNAVAILABLE: PI is not installed in the selected service HOME." >&2
    exit 1
fi
