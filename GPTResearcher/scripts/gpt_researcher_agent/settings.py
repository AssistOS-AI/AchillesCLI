import json
import os

from .io_utils import normalize_string


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
        "AIMLAPI_BASE_URL": "",
        "SOUL_GATEWAY_BASE_URL": "",
    },
}

ALLOWED_ENV_KEYS = set(DEFAULT_SETTINGS["env"].keys())


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
        },
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
