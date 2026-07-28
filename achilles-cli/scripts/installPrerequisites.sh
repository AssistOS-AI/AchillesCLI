#!/usr/bin/env sh
set -eu

if command -v bwrap >/dev/null 2>&1; then
    exit 0
fi

apt-get update
apt-get install -y --no-install-recommends bubblewrap
