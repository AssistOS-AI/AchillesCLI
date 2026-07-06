import json
import os

from .io_utils import normalize_string


SETTINGS_PATH = os.path.join(os.environ["WORKSPACE_PATH"], "gpt-researcher-settings.json")

DEFAULT_SETTINGS = {
    "fastLlm": "codex-api/gpt-5.4-mini",
    "smartLlm": "codex-api/gpt-5.5",
    "strategicLlm": "codex-api/gpt-5.4-mini",
    "embedding": "codestral-embed",
    "searchModel": "duckduckgo/search-duckduckgo",
}


def build_research_query(query, more_context, files_context=""):
    context_parts = [part for part in [more_context, files_context] if part]
    if not context_parts:
        return query
    joined_context = "\n\n".join(context_parts)
    return f"{query}\n\nAdditional context:\n{joined_context}"


def normalize_settings(value):
    source = value if isinstance(value, dict) else {}
    return {
        "fastLlm": normalize_string(source.get("fastLlm")) or DEFAULT_SETTINGS["fastLlm"],
        "smartLlm": normalize_string(source.get("smartLlm")) or DEFAULT_SETTINGS["smartLlm"],
        "strategicLlm": normalize_string(source.get("strategicLlm")) or DEFAULT_SETTINGS["strategicLlm"],
        "embedding": normalize_string(source.get("embedding")) or DEFAULT_SETTINGS["embedding"],
        "searchModel": normalize_string(source.get("searchModel")) or DEFAULT_SETTINGS["searchModel"],
    }


def load_settings():
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as handle:
            return normalize_settings(json.load(handle))
    except FileNotFoundError:
        return normalize_settings(DEFAULT_SETTINGS)


def apply_settings(settings):
    os.environ["FAST_LLM"] = f"soul_gateway:{settings['fastLlm']}"
    os.environ["SMART_LLM"] = f"soul_gateway:{settings['smartLlm']}"
    os.environ["STRATEGIC_LLM"] = f"soul_gateway:{settings['strategicLlm']}"
    os.environ["EMBEDDING"] = f"soul_gateway:{settings['embedding']}"
    os.environ["RETRIEVER"] = "soul_gateway"
    os.environ["SOUL_GATEWAY_SEARCH_MODEL"] = settings["searchModel"]
