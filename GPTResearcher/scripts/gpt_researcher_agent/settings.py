import json
import os

from .io_utils import normalize_string


SETTINGS_PATH = os.path.join(os.environ["HOME"], "gpt-researcher-settings.json")

DEFAULT_SETTINGS = {
    "fastLlm": "fast",
    "smartLlm": "plan",
    "strategicLlm": "deep",
    "embedding": "embeddings",
    "searchProvider": "searxng",
}


def normalize_settings(value):
    source = value if isinstance(value, dict) else {}
    return {
        "fastLlm": normalize_string(source.get("fastLlm")) or DEFAULT_SETTINGS["fastLlm"],
        "smartLlm": normalize_string(source.get("smartLlm")) or DEFAULT_SETTINGS["smartLlm"],
        "strategicLlm": normalize_string(source.get("strategicLlm")) or DEFAULT_SETTINGS["strategicLlm"],
        "embedding": normalize_string(source.get("embedding")) or DEFAULT_SETTINGS["embedding"],
        "searchProvider": normalize_string(source.get("searchProvider")) or DEFAULT_SETTINGS["searchProvider"],
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
    os.environ["SEARCH_AGENT_PROVIDER"] = settings["searchProvider"]
    os.environ["RETRIEVER"] = "search_agent"
