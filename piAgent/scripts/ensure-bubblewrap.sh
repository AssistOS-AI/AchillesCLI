#!/bin/sh
set -eu

if command -v bwrap >/dev/null 2>&1; then
    exit 0
fi

if [ "$(id -u)" -ne 0 ] || ! command -v apt-get >/dev/null 2>&1; then
    echo "ensure-bubblewrap: bwrap is required and cannot be installed in this runtime." >&2
    exit 1
fi

DEBIAN_FRONTEND=noninteractive apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends bubblewrap

if ! command -v bwrap >/dev/null 2>&1; then
    echo "ensure-bubblewrap: bubblewrap installation completed without an executable bwrap." >&2
    exit 1
fi
