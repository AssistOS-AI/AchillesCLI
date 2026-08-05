#!/bin/sh
set -eu

BWRAP_PATH=/usr/bin/bwrap
BWRAP_HELPER_PATH=/usr/local/libexec/ploinky-bwrap-launch

capability_failure() {
    echo "PLOINKY_BWRAP_CAPABILITY_UNAVAILABLE: $1" >&2
    exit 1
}

if ! test -x "$BWRAP_PATH"; then
    capability_failure "the immutable service image does not contain $BWRAP_PATH."
fi

if ! BWRAP_HELP=$("$BWRAP_PATH" --help 2>&1); then
    capability_failure "$BWRAP_PATH could not report its capabilities."
fi

for REQUIRED_OPTION in \
    '--bind-fd FD DEST' \
    '--ro-bind-fd FD DEST' \
    '--ro-bind-data FD DEST' \
    '--perms OCTAL'
do
    if ! printf '%s\n' "$BWRAP_HELP" | awk -v option="$REQUIRED_OPTION" '
        {
            sub(/^[[:space:]]*/, "")
            if ($0 == option || index($0, option "  ") == 1) found = 1
        }
        END { exit found ? 0 : 1 }
    '; then
        capability_failure "$BWRAP_PATH is missing required option $REQUIRED_OPTION."
    fi
done

if ! test -x "$BWRAP_HELPER_PATH"; then
    capability_failure "the immutable service image does not contain $BWRAP_HELPER_PATH."
fi

if ! HELPER_CAPABILITIES=$("$BWRAP_HELPER_PATH" --capabilities 2>&1); then
    capability_failure "$BWRAP_HELPER_PATH could not report its capabilities."
fi

HELPER_PREFIX='ploinky-bwrap-launch-v2 source-sha='
case "$HELPER_CAPABILITIES" in
    "$HELPER_PREFIX"*) ;;
    *) capability_failure "$BWRAP_HELPER_PATH returned an invalid provenance record." ;;
esac
SOURCE_SHA=${HELPER_CAPABILITIES#"$HELPER_PREFIX"}
SOURCE_SHA=${SOURCE_SHA%% *}
case "$SOURCE_SHA" in
    ''|*[!0-9a-f]*) capability_failure "$BWRAP_HELPER_PATH returned an invalid source SHA." ;;
esac
if [ "${#SOURCE_SHA}" -ne 40 ]; then
    capability_failure "$BWRAP_HELPER_PATH returned an invalid source SHA."
fi
EXPECTED_HELPER_CAPABILITIES="$HELPER_PREFIX$SOURCE_SHA protocol=2 descriptor-fd=3 path-resolution=openat2-beneath-no-magiclinks-no-symlinks bwrap-fd-options=bind-fd,ro-bind-fd,ro-bind-data,perms typed-fs=dir,tmpfs,proc,dev,system-symlink,ro-data-path-file ro-data-path-hardening=sealed-memfd-ro-bind-data home-sources=sandbox-workspace-v2,container-native home-marker=ploinky-home-v2-schema-2 home-revalidation=post-barrier-G preexec-barrier=R/G credential-bound=4096"
if [ "$HELPER_CAPABILITIES" != "$EXPECTED_HELPER_CAPABILITIES" ]; then
    capability_failure "$BWRAP_HELPER_PATH returned an incompatible capability record."
fi
