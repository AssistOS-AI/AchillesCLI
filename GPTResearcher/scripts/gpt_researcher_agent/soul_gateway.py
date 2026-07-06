import json
import os
import re
from types import SimpleNamespace

from .io_utils import normalize_string


def normalize_soul_gateway_base_url(value):
    base_url = normalize_string(value)
    if not base_url:
        raise RuntimeError("Soul Gateway provider requires PLOINKY_ROUTER_URL to be set.")
    return base_url.rstrip("/")


def resolve_soul_gateway_chat_url(base_url):
    trimmed = normalize_soul_gateway_base_url(base_url)
    if trimmed.endswith("/chat/completions"):
        return trimmed
    if trimmed.endswith("/embeddings"):
        return f"{trimmed.rsplit('/', 1)[0]}/chat/completions"
    if trimmed.endswith("/v1"):
        return f"{trimmed}/chat/completions"
    return f"{trimmed}/v1/chat/completions"


def resolve_soul_gateway_embeddings_url(base_url):
    trimmed = normalize_soul_gateway_base_url(base_url)
    if trimmed.endswith("/embeddings"):
        return trimmed
    if trimmed.endswith("/chat/completions"):
        return f"{trimmed.removesuffix('/chat/completions')}/embeddings"
    if trimmed.endswith("/v1"):
        return f"{trimmed}/embeddings"
    return f"{trimmed}/v1/embeddings"


def soul_gateway_router_base_url():
    router_url = normalize_string(os.environ.get("PLOINKY_ROUTER_URL"))
    if not router_url:
        raise RuntimeError("Soul Gateway local provider requires PLOINKY_ROUTER_URL.")
    return f"{router_url.rstrip('/')}/services/soul-gateway/v1"


def soul_gateway_api_key():
    api_key = normalize_string(os.environ.get("PLOINKY_AGENT_API_KEY"))
    if not api_key:
        raise RuntimeError("Soul Gateway local provider requires PLOINKY_AGENT_API_KEY.")
    return api_key


def message_to_openai(message):
    if isinstance(message, dict):
        role = message.get("role") or "user"
        content = message.get("content") or message.get("message") or ""
        return {"role": role, "content": content}

    role = getattr(message, "role", None)
    if not role:
        msg_type = getattr(message, "type", None)
        role = {
            "human": "user",
            "ai": "assistant",
            "system": "system",
            "assistant": "assistant",
            "user": "user",
        }.get(msg_type, "user")

    if role == "human":
        role = "user"
    elif role == "ai":
        role = "assistant"

    return {
        "role": role,
        "content": getattr(message, "content", "") or "",
    }


class SoulGatewayLLM:
    def __init__(self, model, base_url, api_key):
        if not model:
            raise RuntimeError("Soul Gateway provider requires a model name.")
        self.model_name = model
        self.base_url = normalize_soul_gateway_base_url(base_url)
        self.chat_url = resolve_soul_gateway_chat_url(base_url)
        self.api_key = api_key

    def bind_tools(self, *args, **kwargs):
        return self

    async def ainvoke(self, messages, **kwargs):
        import httpx

        payload = {
            "model": self.model_name,
            "messages": [message_to_openai(message) for message in messages],
        }
        if "temperature" in kwargs and kwargs["temperature"] is not None:
            payload["temperature"] = kwargs["temperature"]

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        async with httpx.AsyncClient(timeout=None) as client:
            response = await client.post(self.chat_url, headers=headers, json=payload)
            if response.status_code >= 400:
                raise RuntimeError(
                    f"Soul Gateway HTTP {response.status_code}: {response.text}"
                )
            data = response.json()

        if data.get("error"):
            raise RuntimeError(json.dumps(data["error"], ensure_ascii=False))

        content = data.get("choices", [{}])[0].get("message", {}).get("content")
        if not content:
            raise RuntimeError(f"Soul Gateway returned no message content: {data}")
        return SimpleNamespace(content=content)

    async def astream(self, messages, **kwargs):
        result = await self.ainvoke(messages, **kwargs)
        yield SimpleNamespace(content=result.content)


try:
    from langchain_core.embeddings import Embeddings
except ImportError:
    Embeddings = object


class SoulGatewayEmbeddings(Embeddings):
    def __init__(self, model, base_url, api_key):
        if not model:
            raise RuntimeError("Soul Gateway embeddings require a model name.")
        self.model = model
        self.base_url = normalize_soul_gateway_base_url(base_url)
        self.embeddings_url = resolve_soul_gateway_embeddings_url(base_url)
        self.api_key = api_key

    def _headers(self):
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _embed(self, texts):
        import httpx

        payload = {
            "model": self.model,
            "input": texts,
        }
        with httpx.Client(timeout=None) as client:
            response = client.post(self.embeddings_url, headers=self._headers(), json=payload)
            if response.status_code >= 400:
                raise RuntimeError(
                    f"Soul Gateway embeddings HTTP {response.status_code}: {response.text}"
                )
            data = response.json()

        if data.get("error"):
            raise RuntimeError(json.dumps(data["error"], ensure_ascii=False))

        embeddings = [
            item.get("embedding")
            for item in sorted(data.get("data", []), key=lambda item: item.get("index", 0))
        ]
        if len(embeddings) != len(texts) or any(embedding is None for embedding in embeddings):
            raise RuntimeError(f"Soul Gateway returned invalid embeddings payload: {data}")
        return embeddings

    def embed_documents(self, texts):
        return self._embed(list(texts))

    def embed_query(self, text):
        return self._embed([text])[0]


class SoulGatewaySearchRetriever:
    __name__ = "SoulGatewaySearchRetriever"

    def __init__(self, query, query_domains=None):
        self.query = query
        self.query_domains = query_domains or []
        self.model = normalize_string(os.environ.get("SOUL_GATEWAY_SEARCH_MODEL"))
        if not self.model:
            raise RuntimeError("Soul Gateway retriever requires SOUL_GATEWAY_SEARCH_MODEL.")
        self.chat_url = resolve_soul_gateway_chat_url(soul_gateway_router_base_url())
        self.api_key = soul_gateway_api_key()

    def search(self, max_results=5):
        import httpx

        query = self.query
        if self.query_domains:
            domains = ", ".join(self.query_domains)
            query = f"{query}\n\nRestrict results to these domains when possible: {domains}"

        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": query}],
            "stream": False,
        }
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }
        with httpx.Client(timeout=None) as client:
            response = client.post(self.chat_url, headers=headers, json=payload)
            if response.status_code >= 400:
                raise RuntimeError(
                    f"Soul Gateway search HTTP {response.status_code}: {response.text}"
                )
            data = response.json()

        if data.get("error"):
            raise RuntimeError(json.dumps(data["error"], ensure_ascii=False))

        content = data.get("choices", [{}])[0].get("message", {}).get("content")
        if not content:
            raise RuntimeError(f"Soul Gateway search returned no content: {data}")

        return parse_soul_gateway_search_results(content, max_results=max_results)


def parse_soul_gateway_search_results(content, max_results=5):
    text = normalize_string(content)
    if not text:
        return []

    results = []
    current = None

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        heading = re.match(r"^#{1,4}\s*\[?(\d+)\]?\s*(.+)$", line)
        numbered = re.match(r"^\d+\.\s+\*\*(.+?)\*\*(?:\s+\(via .+?\))?$", line)
        if heading or numbered:
            if current:
                results.append(current)
            title = heading.group(2) if heading else numbered.group(1)
            current = {"title": title.strip(), "href": "", "body": ""}
            continue

        if current is None:
            continue

        source_url = ""
        if line.startswith(">"):
            source_url = line[1:].strip()
        elif line.startswith("http://") or line.startswith("https://"):
            source_url = line

        if source_url:
            current["href"] = source_url
            current["url"] = source_url
            continue

        if (
            line.startswith("---")
            or line.lower().startswith("**sources:**")
            or re.match(r"^\[\d+\]\s+\[.+?\]\(.+?\)$", line)
        ):
            continue

        if current["body"]:
            current["body"] += " "
        current["body"] += line

    if current:
        results.append(current)

    if not results:
        raise RuntimeError(f"Soul Gateway search response had no parseable results: {text[:1000]}")

    normalized = []
    for result in results[:max_results]:
        url = result.get("href") or result.get("url") or ""
        normalized.append({
            "title": result.get("title") or url or "Soul Gateway search result",
            "href": url,
            "url": url,
            "body": result.get("body") or "",
            "content": result.get("body") or "",
        })
    return normalized


def patch_gpt_researcher_llm_providers():
    from gpt_researcher.llm_provider.generic.base import GenericLLMProvider
    from gpt_researcher.llm_provider.generic import base as generic_base
    from gpt_researcher.memory import embeddings as embeddings_module

    if getattr(GenericLLMProvider, "_ploinky_soul_gateway_patch", False):
        return

    generic_base._SUPPORTED_PROVIDERS.add("soul_gateway")
    embeddings_module._SUPPORTED_PROVIDERS.add("soul_gateway")
    original_from_provider = GenericLLMProvider.from_provider.__func__
    original_memory_init = embeddings_module.Memory.__init__

    @classmethod
    def from_provider(cls, provider, chat_log=None, verbose=True, **kwargs):
        if provider == "soul_gateway":
            model = kwargs.get("model") or kwargs.get("model_name")
            return cls(
                SoulGatewayLLM(
                    model=model,
                    base_url=soul_gateway_router_base_url(),
                    api_key=soul_gateway_api_key(),
                ),
                chat_log,
                verbose=verbose,
            )
        return original_from_provider(
            cls,
            provider,
            chat_log=chat_log,
            verbose=verbose,
            **kwargs,
        )

    def memory_init(self, embedding_provider, model, **embedding_kwargs):
        if embedding_provider == "soul_gateway":
            self._embeddings = SoulGatewayEmbeddings(
                model=model,
                base_url=soul_gateway_router_base_url(),
                api_key=soul_gateway_api_key(),
            )
            return
        original_memory_init(self, embedding_provider, model, **embedding_kwargs)

    GenericLLMProvider.from_provider = from_provider
    embeddings_module.Memory.__init__ = memory_init
    GenericLLMProvider._ploinky_soul_gateway_patch = True


def patch_gpt_researcher_retriever():
    from gpt_researcher.actions import retriever as retriever_module
    from gpt_researcher.retrievers import utils as retriever_utils

    if getattr(retriever_module, "_ploinky_soul_gateway_retriever_patch", False):
        return

    original_get_retriever = retriever_module.get_retriever
    original_get_all_retriever_names = retriever_utils.get_all_retriever_names

    def get_retriever(retriever):
        if retriever == "soul_gateway":
            return SoulGatewaySearchRetriever
        return original_get_retriever(retriever)

    def get_all_retriever_names():
        names = list(original_get_all_retriever_names() or [])
        if "soul_gateway" not in names:
            names.append("soul_gateway")
        return names

    retriever_module.get_retriever = get_retriever
    retriever_utils.get_all_retriever_names = get_all_retriever_names
    retriever_module._ploinky_soul_gateway_retriever_patch = True
