#!/bin/sh

python3 - <<'PY'
import json
import sys
import urllib.error
import urllib.request

checks = [
    ("AgentServer", "http://127.0.0.1:7000/health", True),
    ("GPT Researcher UI", "http://127.0.0.1:8000/services/gpt-researcher/", False),
]

for label, url, expect_json_ok in checks:
    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            body = response.read().decode("utf-8", errors="replace")
            if response.status != 200:
                print(f"{label} returned HTTP {response.status}: {body[:500]}", file=sys.stderr)
                raise SystemExit(1)
            if expect_json_ok:
                payload = json.loads(body)
                if payload.get("ok") is not True:
                    print(f"{label} returned unexpected payload: {body[:500]}", file=sys.stderr)
                    raise SystemExit(1)
    except (OSError, urllib.error.URLError, ValueError) as error:
        print(f"{label} is not ready on {url}: {error}", file=sys.stderr)
        raise SystemExit(1)
PY
