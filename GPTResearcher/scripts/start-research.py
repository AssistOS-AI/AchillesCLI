#!/usr/bin/env python3

import asyncio
import contextlib
import io
import json
import os
import sys
import time
import traceback

SETTINGS_PATH = os.path.join(os.environ["WORKSPACE_PATH"], "gpt-researcher-settings.json")

DEFAULT_SETTINGS = {
    "fastLlm": "ollama:llama3.1",
    "smartLlm": "ollama:llama3.1",
    "strategicLlm": "ollama:llama3.1",
    "embedding": "ollama:nomic-embed-text",
    "retriever": "duckduckgo",
    "env": {
        "OLLAMA_BASE_URL": "http://host.containers.internal:11434",
        "OPENAI_BASE_URL": "",
        "AZURE_OPENAI_ENDPOINT": "",
        "AZURE_OPENAI_API_VERSION": "",
        "MISTRAL_BASE_URL": "",
        "OPENROUTER_LIMIT_RPS": "",
        "VLLM_OPENAI_API_BASE": "",
        "AIMLAPI_BASE_URL": ""
    }
}

ALLOWED_ENV_KEYS = set(DEFAULT_SETTINGS["env"].keys())


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


def build_research_query(query, more_context):
    if not more_context:
        return query
    return f"{query}\n\nAdditional context:\n{more_context}"


def normalize_settings(value):
    source = value if isinstance(value, dict) else {}
    env_source = source.get("env") if isinstance(source.get("env"), dict) else {}
    return {
        "fastLlm": normalize_string(source.get("fastLlm")) or DEFAULT_SETTINGS["fastLlm"],
        "smartLlm": normalize_string(source.get("smartLlm")) or DEFAULT_SETTINGS["smartLlm"],
        "strategicLlm": normalize_string(source.get("strategicLlm")) or DEFAULT_SETTINGS["strategicLlm"],
        "embedding": normalize_string(source.get("embedding")) or DEFAULT_SETTINGS["embedding"],
        "retriever": normalize_string(source.get("retriever")) or DEFAULT_SETTINGS["retriever"],
        "env": {
            key: normalize_string(env_source.get(key)) or DEFAULT_SETTINGS["env"].get(key, "")
            for key in ALLOWED_ENV_KEYS
        }
    }


def load_settings():
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as handle:
            return normalize_settings(json.load(handle))
    except FileNotFoundError:
        return normalize_settings(DEFAULT_SETTINGS)


def apply_settings(settings):
    os.environ["FAST_LLM"] = settings["fastLlm"]
    os.environ["SMART_LLM"] = settings["smartLlm"]
    os.environ["STRATEGIC_LLM"] = settings["strategicLlm"]
    os.environ["EMBEDDING"] = settings["embedding"]
    os.environ["RETRIEVER"] = settings["retriever"]
    for key, value in settings["env"].items():
        if key in ALLOWED_ENV_KEYS:
            if value:
                os.environ[key] = value
            else:
                os.environ.pop(key, None)


def should_force_chat_completions(kwargs):
    model = kwargs.get("model") or kwargs.get("model_name")
    base_url = (
        kwargs.get("openai_api_base")
        or kwargs.get("base_url")
        or kwargs.get("baseURL")
        or os.environ.get("OPENAI_BASE_URL", "")
    )
    return (
        isinstance(model, str)
        and model.startswith("codex-api/")
        and isinstance(base_url, str)
        and "soul-gateway" in base_url
    )


def patch_soul_gateway_codex_chat_completions():
    from gpt_researcher.llm_provider.generic.base import GenericLLMProvider

    if getattr(GenericLLMProvider, "_ploinky_codex_chat_patch", False):
        return

    original_from_provider = GenericLLMProvider.from_provider.__func__

    @classmethod
    def from_provider(cls, provider, chat_log=None, verbose=True, **kwargs):
        if provider == "openai" and should_force_chat_completions(kwargs):
            kwargs.setdefault("use_responses_api", False)
            kwargs.pop("max_tokens", None)
            kwargs.pop("max_completion_tokens", None)
        return original_from_provider(
            cls,
            provider,
            chat_log=chat_log,
            verbose=verbose,
            **kwargs,
        )

    GenericLLMProvider.from_provider = from_provider
    GenericLLMProvider._ploinky_codex_chat_patch = True


def optional_call(obj, name):
    method = getattr(obj, name, None)
    if not callable(method):
        return None
    try:
        return method()
    except Exception:
        return None


async def run_research(payload):
    query = normalize_string(payload.get("query"))
    more_context = normalize_string(payload.get("moreContext"))
    report_type = normalize_string(payload.get("reportType")) or "research_report"

    if not query:
        write_json({
            "ok": False,
            "error": "query is required and must be a non-empty string.",
        })
        return 1

    started_at = time.time()
    effective_query = build_research_query(query, more_context)
    log_buffer = io.StringIO()

    try:
        settings = load_settings()
        apply_settings(settings)
        log_line(
            "[GPTResearcher/start_research] start "
            f"queryChars={len(query)} reportType={report_type} "
            f"fastLlm={settings['fastLlm']} smartLlm={settings['smartLlm']} "
            f"strategicLlm={settings['strategicLlm']} embedding={settings['embedding']} "
            f"retriever={settings['retriever']}"
        )
        patch_soul_gateway_codex_chat_completions()
        from gpt_researcher import GPTResearcher

        researcher = GPTResearcher(query=effective_query, report_type=report_type)
        live_logs = LiveLogTee(log_buffer, sys.stderr)
        with contextlib.redirect_stdout(live_logs), contextlib.redirect_stderr(live_logs):
            log_line("[GPTResearcher/start_research] conduct_research started")
            await researcher.conduct_research()
            log_line("[GPTResearcher/start_research] conduct_research completed")
            log_line("[GPTResearcher/start_research] write_report started")
            report = await researcher.write_report()
            log_line("[GPTResearcher/start_research] write_report completed")

        write_json({
            "ok": True,
            "query": query,
            "moreContext": more_context,
            "reportType": report_type,
            "settings": settings,
            "report": report,
            "researchContext": optional_call(researcher, "get_research_context"),
            "costs": optional_call(researcher, "get_costs"),
            "images": optional_call(researcher, "get_research_images"),
            "sources": optional_call(researcher, "get_research_sources"),
            "sourceUrls": optional_call(researcher, "get_source_urls"),
            "logTail": log_buffer.getvalue()[-16384:].strip(),
            "durationMs": int((time.time() - started_at) * 1000),
        })
        return 0
    except Exception as error:
        sys.stderr.write(f"[GPTResearcher/start_research] {error}\n")
        sys.stderr.write(traceback.format_exc())
        write_json({
            "ok": False,
            "error": str(error),
            "query": query,
            "moreContext": more_context,
            "reportType": report_type,
            "settings": locals().get("settings"),
            "logTail": log_buffer.getvalue()[-16384:].strip(),
            "durationMs": int((time.time() - started_at) * 1000),
        })
        return 1


async def main():
    payload = parse_input(sys.stdin.read())
    if payload is None:
        write_json({
            "ok": False,
            "error": "Invalid or missing input. Expected JSON with query.",
        })
        return 1
    return await run_research(payload)


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
