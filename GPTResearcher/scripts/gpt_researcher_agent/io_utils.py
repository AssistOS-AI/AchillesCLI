import io
import json
import sys


class LiveLogTee(io.TextIOBase):
    def __init__(self, buffer, stream):
        self.buffer = buffer
        self.stream = stream

    def writable(self):
        return True

    def write(self, value):
        text = str(value)
        self.buffer.write(text)
        self.stream.write(text)
        self.stream.flush()
        return len(text)

    def flush(self):
        self.buffer.flush()
        self.stream.flush()


def parse_input(raw):
    text = (raw or "").strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return None
    if isinstance(parsed, dict) and isinstance(parsed.get("input"), dict):
        return parsed["input"]
    return parsed if isinstance(parsed, dict) else None


def normalize_string(value):
    return value.strip() if isinstance(value, str) else ""


def write_json(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, default=str))


def log_line(message):
    sys.stderr.write(f"{message}\n")
    sys.stderr.flush()


def optional_call(obj, name):
    method = getattr(obj, name, None)
    if not callable(method):
        return None
    try:
        return method()
    except Exception:
        return None
