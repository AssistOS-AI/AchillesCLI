import json
import os
import subprocess

from .io_utils import normalize_string


def call_search_agent_mcp(payload):
    completed = subprocess.run(
        ["/usr/local/bin/node", "/code/scripts/call-search-agent.mjs"],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        check=False,
    )
    stdout = completed.stdout.strip()
    try:
        data = json.loads(stdout) if stdout else {}
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"SearchAgent MCP returned invalid JSON: {stdout[:500]}") from exc
    if completed.returncode != 0:
        message = data.get("error") if isinstance(data, dict) else ""
        raise RuntimeError(message or completed.stderr.strip() or "SearchAgent MCP call failed.")
    return data


class SearchAgentSearchRetriever:
    __name__ = "SearchAgentSearchRetriever"

    def __init__(self, query, query_domains=None):
        self.query = query
        self.query_domains = query_domains or []
        self.provider = normalize_string(os.environ.get("SEARCH_AGENT_PROVIDER")) or "duckduckgo"

    def search(self, max_results=5):
        query = self.query
        if self.query_domains:
            domains = ", ".join(self.query_domains)
            query = f"{query}\n\nRestrict results to these domains when possible: {domains}"

        payload = {
            "provider": self.provider,
            "query": query,
            "maxResults": max_results,
        }
        data = call_search_agent_mcp(payload)

        if data.get("error"):
            raise RuntimeError(json.dumps(data["error"], ensure_ascii=False))

        results = data.get("results")
        if not isinstance(results, list):
            raise RuntimeError(f"SearchAgent returned invalid results payload: {data}")

        normalized = []
        for result in results[:max_results]:
            if not isinstance(result, dict):
                continue
            url = normalize_string(result.get("url") or result.get("href"))
            snippet = normalize_string(result.get("snippet") or result.get("body") or result.get("content"))
            normalized.append({
                "title": normalize_string(result.get("title")) or url or "SearchAgent result",
                "href": url,
                "url": url,
                "body": snippet,
                "content": snippet,
            })
        return normalized


def patch_gpt_researcher_retriever():
    from gpt_researcher.actions import retriever as retriever_module
    from gpt_researcher.retrievers import utils as retriever_utils

    if getattr(retriever_module, "_ploinky_search_agent_retriever_patch", False):
        return

    original_get_retriever = retriever_module.get_retriever
    original_get_all_retriever_names = retriever_utils.get_all_retriever_names

    def get_retriever(retriever):
        if retriever == "search_agent":
            return SearchAgentSearchRetriever
        return original_get_retriever(retriever)

    def get_all_retriever_names():
        names = list(original_get_all_retriever_names() or [])
        if "search_agent" not in names:
            names.append("search_agent")
        return names

    retriever_module.get_retriever = get_retriever
    retriever_utils.get_all_retriever_names = get_all_retriever_names
    retriever_module._ploinky_search_agent_retriever_patch = True
