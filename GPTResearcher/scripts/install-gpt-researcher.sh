#!/bin/sh
set -eu

VENV_DIR=/opt/gpt-researcher-venv
APP_DIR=/opt/gpt-researcher-app
SYSTEM_PYTHON=/usr/bin/python3
SYSTEM_PYTHON_REAL=/usr/bin/python3.11
SYSTEM_PYTHON_HOME=/usr/bin
LOCK_FILE=/code/scripts/gpt-researcher-requirements.lock
BOOTSTRAP_LOCK_FILE=/code/scripts/gpt-researcher-bootstrap.lock
SOURCE_URL=https://github.com/assafelovic/gpt-researcher.git
SOURCE_COMMIT=5cdad9cb434754188b78bd998df18dd8d502cf7e
SOURCE_REQUIREMENTS_SHA256=f8c36b147c9f53d96bd20f41df303943889ac90323603285fafe97dcc9a84b60
LOCK_SHA256=3c81338133667f49c3c7366b36c943f9e456663faa27eb3486bf8fd7bf08f6bb
BOOTSTRAP_LOCK_SHA256=4e5068e06240daf19cf2ca08370a5413e5af634d3a3cb70198cfe4b0b9289386
INSTALL_SCHEMA=gpt-researcher-v5-lock-1
INSTALL_MARKER="$VENV_DIR/.ploinky-install-v5"
SITE_PACKAGES_DIR="$VENV_DIR/lib/python3.11/site-packages"
RUNTIME_POLICY_FILE="$SITE_PACKAGES_DIR/ploinky_gpt_researcher_v5.pth"
RUNTIME_POLICY_SHA256=d975cade6e94b6039f6ce18b9c796318a748a74a8fde288df3caad09fdfca7b3

export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_OPTIONAL_LOCKS=0
export GIT_TERMINAL_PROMPT=0

fail_existing_state() {
    echo "[GPTResearcher/install] Existing pre-v5, incomplete, or tampered runtime state at $APP_DIR or $VENV_DIR." >&2
    echo "[GPTResearcher/install] Remove both directories explicitly and recreate the agent; v5 does not migrate, repair, or replace them." >&2
    exit 1
}

fail_artifact_integrity() {
    echo "[GPTResearcher/install] Immutable dependency artifact digest mismatch: $1." >&2
    echo "[GPTResearcher/install] Restore the exact v5 agent image; dependency resolution and network fallback are forbidden." >&2
    exit 1
}

sha256_file() {
    sha256sum "$1" | awk '{print $1}'
}

verify_file_digest() {
    actual_digest="$(sha256_file "$1")" || fail_artifact_integrity "$1"
    [ "$actual_digest" = "$2" ] || fail_artifact_integrity "$1"
}

runtime_id() {
    "$1" -I -S -c 'import platform; print(":".join((platform.python_implementation(), platform.python_version(), platform.system(), platform.machine())))'
}

verify_supported_runtime() {
    probed_runtime="$(runtime_id "$1")" || {
        echo "[GPTResearcher/install] Unable to inspect the Python runtime." >&2
        exit 1
    }

    case "$probed_runtime" in
        CPython:3.11.2:Linux:x86_64|CPython:3.11.2:Linux:aarch64)
            ;;
        *)
            echo "[GPTResearcher/install] Unsupported Python target: $probed_runtime." >&2
            echo "[GPTResearcher/install] This lock supports only CPython 3.11.2 on Linux x86_64 or aarch64." >&2
            exit 1
            ;;
    esac

    printf '%s\n' "$probed_runtime"
}

expected_venv_config() {
    printf '%s\n' \
        "home = $SYSTEM_PYTHON_HOME" \
        'include-system-site-packages = false' \
        'version = 3.11.2' \
        "executable = $SYSTEM_PYTHON_REAL" \
        "command = $SYSTEM_PYTHON -m venv $VENV_DIR"
}

verify_venv_launcher() {
    [ -L "$VENV_DIR/bin/python" ] || return 1
    [ "$(readlink "$VENV_DIR/bin/python")" = python3 ] || return 1
    [ -L "$VENV_DIR/bin/python3" ] || return 1
    [ "$(readlink "$VENV_DIR/bin/python3")" = "$SYSTEM_PYTHON" ] || return 1
    [ -L "$VENV_DIR/bin/python3.11" ] || return 1
    [ "$(readlink "$VENV_DIR/bin/python3.11")" = python3 ] || return 1
    [ -f "$VENV_DIR/pyvenv.cfg" ] || return 1
    [ "$(cat "$VENV_DIR/pyvenv.cfg")" = "$(expected_venv_config)" ] || return 1
}

verify_source_checkout() {
    [ -d "$APP_DIR/.git" ] || return 1
    [ ! -L "$APP_DIR/.git" ] || return 1
    [ "$(git -C "$APP_DIR" remote get-url origin)" = "$SOURCE_URL" ] || return 1
    [ "$(git -C "$APP_DIR" rev-parse HEAD)" = "$SOURCE_COMMIT" ] || return 1
    git -C "$APP_DIR" cat-file -e "$SOURCE_COMMIT^{commit}" || return 1
    git -C "$APP_DIR" fsck --full --strict --no-reflogs --no-progress "$SOURCE_COMMIT" >/dev/null || return 1
    verify_worktree_bytes || return 1
    [ -f "$APP_DIR/requirements.txt" ] || return 1
    [ "$(sha256_file "$APP_DIR/requirements.txt")" = "$SOURCE_REQUIREMENTS_SHA256" ] || return 1
}

verify_worktree_bytes() {
    "$SYSTEM_PYTHON" -I -S - "$APP_DIR" "$SOURCE_COMMIT" <<'PY'
import hashlib
import os
import stat
import subprocess
import sys
from pathlib import Path, PurePosixPath


root = Path(sys.argv[1])
commit = sys.argv[2]
tree = subprocess.run(
    ["git", "-C", str(root), "ls-tree", "-rz", "--full-tree", commit],
    check=True,
    stdout=subprocess.PIPE,
).stdout

tracked = set()
tracked_directories = set()
for entry in tree.split(b"\0"):
    if not entry:
        continue
    metadata, raw_path = entry.split(b"\t", 1)
    mode, object_type, expected_oid = metadata.decode("ascii").split()
    if object_type != "blob" or len(expected_oid) != 40:
        raise SystemExit(f"unsupported immutable source entry: {raw_path!r}")

    source_path = PurePosixPath(os.fsdecode(raw_path))
    if source_path.is_absolute() or ".." in source_path.parts:
        raise SystemExit(f"unsafe immutable source path: {source_path}")
    tracked.add(source_path.as_posix())
    tracked_directories.update(
        parent.as_posix()
        for parent in source_path.parents
        if parent != PurePosixPath(".")
    )
    installed_path = root.joinpath(*source_path.parts)
    try:
        file_stat = installed_path.lstat()
    except OSError as error:
        raise SystemExit(f"missing immutable source entry {source_path}: {error}") from error

    if mode == "120000":
        if not stat.S_ISLNK(file_stat.st_mode):
            raise SystemExit(f"immutable source type mismatch: {source_path}")
        payload = os.fsencode(os.readlink(installed_path))
    elif mode in {"100644", "100755"}:
        if not stat.S_ISREG(file_stat.st_mode):
            raise SystemExit(f"immutable source type mismatch: {source_path}")
        executable = bool(file_stat.st_mode & 0o111)
        if executable != (mode == "100755"):
            raise SystemExit(f"immutable source mode mismatch: {source_path}")
        payload = installed_path.read_bytes()
    else:
        raise SystemExit(f"unsupported immutable source mode {mode}: {source_path}")

    actual_oid = hashlib.sha1(b"blob " + str(len(payload)).encode("ascii") + b"\0" + payload).hexdigest()
    if actual_oid != expected_oid:
        raise SystemExit(f"immutable source digest mismatch: {source_path}")

present = set()
present_directories = set()
for directory, directory_names, file_names in os.walk(root, topdown=True, followlinks=False):
    directory_path = Path(directory)
    if directory_path == root and ".git" in directory_names:
        directory_names.remove(".git")
    for name in list(directory_names):
        candidate = directory_path / name
        if candidate.is_symlink():
            present.add(candidate.relative_to(root).as_posix())
            directory_names.remove(name)
        else:
            present_directories.add(candidate.relative_to(root).as_posix())
    for name in file_names:
        present.add((directory_path / name).relative_to(root).as_posix())

untracked = sorted(present - tracked)
if untracked:
    raise SystemExit(f"untracked immutable source entry: {untracked[0]}")
untracked_directories = sorted(present_directories - tracked_directories)
if untracked_directories:
    raise SystemExit(f"untracked immutable source directory: {untracked_directories[0]}")
PY
}

verify_source_is_sealed() {
    [ -z "$(find "$APP_DIR" \( -type f -o -type d \) \( -perm -200 -o -perm -020 -o -perm -002 \) -print -quit)" ]
}

environment_digest() {
    PLOINKY_RUNTIME_POLICY_FILE="$RUNTIME_POLICY_FILE" \
        PLOINKY_SITE_PACKAGES="$SITE_PACKAGES_DIR" \
        "$VENV_DIR/bin/python" -I -S - <<'PY'
import base64
import hashlib
import os
from importlib import metadata
from pathlib import Path


def canonical_name(value):
    return value.lower().replace("_", "-").replace(".", "-")


inventory = []
claimed_paths = set()
site_packages = [Path(os.environ["PLOINKY_SITE_PACKAGES"]).absolute()]
if not site_packages[0].is_dir():
    raise SystemExit(f"missing venv site-packages: {site_packages[0]}")
for distribution in metadata.distributions(path=[str(item) for item in site_packages]):
    name = distribution.metadata.get("Name")
    if not name:
        raise SystemExit("installed distribution is missing its Name metadata")
    files = distribution.files
    if files is None:
        raise SystemExit(f"{name}=={distribution.version} has no RECORD inventory")

    inventory.append(f"distribution:{canonical_name(name)}=={distribution.version}")
    for package_path in sorted(files, key=str):
        installed_path = Path(distribution.locate_file(package_path)).absolute()
        claimed_paths.add(installed_path)
        try:
            payload = installed_path.read_bytes()
        except OSError as error:
            raise SystemExit(f"cannot read installed file {installed_path}: {error}") from error
        actual_sha256 = hashlib.sha256(payload).hexdigest()

        recorded_hash = package_path.hash
        record_text = "unhashed"
        if recorded_hash is not None:
            algorithm = recorded_hash.mode
            if algorithm not in hashlib.algorithms_available:
                raise SystemExit(f"unsupported RECORD hash algorithm {algorithm} for {name}")
            actual = base64.urlsafe_b64encode(hashlib.new(algorithm, payload).digest()).rstrip(b"=").decode("ascii")
            # pip-generated bytecode and rewritten console entry points are not
            # guaranteed to retain the digest written to the wheel's RECORD.
            # Their actual bytes are still generation-bound below and must be
            # identical on every reuse.
            pip_rewrites_file = package_path.suffix in {".pyc", ".pyo"} or ".." in package_path.parts
            if not pip_rewrites_file and actual != recorded_hash.value:
                raise SystemExit(f"installed file digest mismatch: {installed_path}")
            record_text = f"{algorithm}={recorded_hash.value}"
        inventory.append(
            f"file:{canonical_name(name)}:{package_path}:record={record_text}:actual-sha256={actual_sha256}"
        )

runtime_policy = Path(os.environ["PLOINKY_RUNTIME_POLICY_FILE"]).absolute()
for site_package in site_packages:
    for installed_path in site_package.rglob("*"):
        absolute_path = installed_path.absolute()
        if installed_path.is_dir() and not installed_path.is_symlink():
            continue
        if absolute_path not in claimed_paths and absolute_path != runtime_policy:
            raise SystemExit(f"unowned installed file: {absolute_path}")

print(hashlib.sha256(("\n".join(sorted(inventory)) + "\n").encode("utf-8")).hexdigest())
PY
}

marker_content() {
    printf '%s\n' \
        "schema=$INSTALL_SCHEMA" \
        "source_commit=$SOURCE_COMMIT" \
        "source_requirements_sha256=$SOURCE_REQUIREMENTS_SHA256" \
        "lock_sha256=$LOCK_SHA256" \
        "bootstrap_lock_sha256=$BOOTSTRAP_LOCK_SHA256" \
        "runtime_policy_sha256=$RUNTIME_POLICY_SHA256" \
        "venv_config_sha256=$VENV_CONFIG_SHA256" \
        "runtime=$RUNTIME" \
        "environment_sha256=$1"
}

verify_file_digest "$LOCK_FILE" "$LOCK_SHA256"
verify_file_digest "$BOOTSTRAP_LOCK_FILE" "$BOOTSTRAP_LOCK_SHA256"
RUNTIME="$(verify_supported_runtime "$SYSTEM_PYTHON")"
VENV_CONFIG_SHA256="$(expected_venv_config | sha256sum | awk '{print $1}')"

if [ -e "$APP_DIR" ] || [ -e "$VENV_DIR" ]; then
    [ -d "$APP_DIR" ] || fail_existing_state
    [ -d "$VENV_DIR" ] || fail_existing_state
    verify_venv_launcher || fail_existing_state
    [ -x "$VENV_DIR/bin/python" ] || fail_existing_state
    [ -f "$RUNTIME_POLICY_FILE" ] || fail_existing_state
    [ "$(sha256_file "$RUNTIME_POLICY_FILE")" = "$RUNTIME_POLICY_SHA256" ] || fail_existing_state
    [ "$(verify_supported_runtime "$VENV_DIR/bin/python")" = "$RUNTIME" ] || fail_existing_state
    verify_source_checkout || fail_existing_state
    verify_source_is_sealed || fail_existing_state
    [ -f "$INSTALL_MARKER" ] || fail_existing_state

    recorded_environment_digest="$(sed -n 's/^environment_sha256=\([0-9a-f][0-9a-f]*\)$/\1/p' "$INSTALL_MARKER")"
    printf '%s\n' "$recorded_environment_digest" | grep -Eq '^[0-9a-f]{64}$' || fail_existing_state
    [ "$(cat "$INSTALL_MARKER")" = "$(marker_content "$recorded_environment_digest")" ] || fail_existing_state

    current_environment_digest="$(environment_digest)" || fail_existing_state
    [ "$current_environment_digest" = "$recorded_environment_digest" ] || fail_existing_state
    PYTHONDONTWRITEBYTECODE=1 "$VENV_DIR/bin/python" -I -B -m pip --isolated check || fail_existing_state
else
    "$SYSTEM_PYTHON" -I -m venv "$VENV_DIR"
    verify_venv_launcher || fail_existing_state
    [ "$(verify_supported_runtime "$VENV_DIR/bin/python")" = "$RUNTIME" ] || fail_existing_state

    mkdir "$APP_DIR"
    git -C "$APP_DIR" init
    git -C "$APP_DIR" remote add origin "$SOURCE_URL"
    git -C "$APP_DIR" fetch --depth 1 origin "$SOURCE_COMMIT"
    git -C "$APP_DIR" checkout --detach FETCH_HEAD
    verify_source_checkout || {
        echo "[GPTResearcher/install] Source checkout digest or content mismatch." >&2
        exit 1
    }
    chmod -R a-w "$APP_DIR"
    verify_source_is_sealed || {
        echo "[GPTResearcher/install] Immutable source checkout could not be sealed read-only." >&2
        exit 1
    }

    PYTHONDONTWRITEBYTECODE=1 "$VENV_DIR/bin/python" -I -B -m pip --isolated install \
        --disable-pip-version-check \
        --no-cache-dir \
        --no-compile \
        --require-hashes \
        --only-binary=:all: \
        -r "$BOOTSTRAP_LOCK_FILE"
    PYTHONDONTWRITEBYTECODE=1 "$VENV_DIR/bin/python" -I -B -m pip --isolated install \
        --disable-pip-version-check \
        --no-cache-dir \
        --no-compile \
        --require-hashes \
        --no-build-isolation \
        --only-binary=:all: \
        --no-binary=docopt,langdetect,sgmllib3k \
        -r "$LOCK_FILE"
    PYTHONDONTWRITEBYTECODE=1 "$VENV_DIR/bin/python" -I -B -m pip --isolated check

    [ -d "$SITE_PACKAGES_DIR" ] || fail_existing_state
    printf '%s\n' 'import sys; sys.dont_write_bytecode = True' > "$RUNTIME_POLICY_FILE"
    [ "$(sha256_file "$RUNTIME_POLICY_FILE")" = "$RUNTIME_POLICY_SHA256" ] || fail_existing_state

    installed_environment_digest="$(environment_digest)" || fail_existing_state
    marker_content "$installed_environment_digest" > "$INSTALL_MARKER"
fi

: "${WORKSPACE_PATH:?WORKSPACE_PATH is required}"
: "${HOME:?HOME is required}"

mkdir -p "$WORKSPACE_PATH" "$HOME"

SETTINGS_PATH="$HOME/gpt-researcher-settings.json"
if [ ! -f "$SETTINGS_PATH" ]; then
    printf '%s\n' \
        '{' \
        '  "fastLlm": "codex-api/gpt-5.4-mini",' \
        '  "smartLlm": "codex-api/gpt-5.5",' \
        '  "strategicLlm": "codex-api/gpt-5.4-mini",' \
        '  "embedding": "codestral-embed",' \
        '  "searchProvider": "searxng"' \
        '}' > "$SETTINGS_PATH"
fi
