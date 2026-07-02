import json
import os
from types import SimpleNamespace

from .io_utils import normalize_string


def normalize_soul_gateway_base_url(value):
    base_url = normalize_string(value)
    if not base_url:
        raise RuntimeError("Soul Gateway provider requires SOUL_GATEWAY_BASE_URL to be set.")
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


class SoulGatewayEmbeddings:
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
                    base_url=os.environ.get("SOUL_GATEWAY_BASE_URL", ""),
                    api_key=os.environ.get("SOUL_GATEWAY_API_KEY", ""),
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
                base_url=os.environ.get("SOUL_GATEWAY_BASE_URL", ""),
                api_key=os.environ.get("SOUL_GATEWAY_API_KEY", ""),
            )
            return
        original_memory_init(self, embedding_provider, model, **embedding_kwargs)

    GenericLLMProvider.from_provider = from_provider
    embeddings_module.Memory.__init__ = memory_init
    GenericLLMProvider._ploinky_soul_gateway_patch = True
