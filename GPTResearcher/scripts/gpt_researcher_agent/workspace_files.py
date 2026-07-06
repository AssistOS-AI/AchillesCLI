import os
import re
from datetime import datetime, timezone

from .io_utils import normalize_string


IGNORED_WORKING_DIR_ENTRIES = {
    ".cache",
    ".tasksQueue",
    "gpt-researcher-settings.json",
    "mcp-config.json",
}


def workspace_root():
    root = normalize_string(os.environ.get("WORKSPACE_PATH"))
    if not root:
        raise RuntimeError("WORKSPACE_PATH is required.")
    return os.path.realpath(root)


def resolve_working_dir(value):
    root = workspace_root()
    requested = normalize_string(value)
    path = os.path.join(root, requested) if requested and not os.path.isabs(requested) else (requested or root)
    resolved = os.path.realpath(path)
    if resolved != root and not resolved.startswith(f"{root}{os.sep}"):
        raise RuntimeError("workingDir must be inside WORKSPACE_PATH.")
    os.makedirs(resolved, exist_ok=True)
    return resolved


def list_working_dir_files(working_dir):
    entries = []
    for name in sorted(os.listdir(working_dir)):
        if name in IGNORED_WORKING_DIR_ENTRIES:
            continue
        path = os.path.join(working_dir, name)
        if not os.path.isfile(path):
            continue
        entries.append(path)
    return entries


def slugify_filename(value):
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", normalize_string(value).lower()).strip("-")
    return slug[:64] or "research-report"


def write_report_file(working_dir, query, report):
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"gpt-researcher-{timestamp}-{slugify_filename(query)}.md"
    path = os.path.join(working_dir, filename)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(report or "")
        if report and not report.endswith("\n"):
            handle.write("\n")
    return path
