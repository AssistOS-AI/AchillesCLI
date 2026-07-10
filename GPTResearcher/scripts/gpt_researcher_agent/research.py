import contextlib
import io
import os
import sys
import time
import traceback

from .io_utils import LiveLogTee, log_line, normalize_string, optional_call, write_json
from .search_agent import patch_gpt_researcher_retriever
from .settings import apply_settings, load_settings
from .soul_gateway import patch_gpt_researcher_llm_providers
from .workspace_files import list_working_dir_files, resolve_working_dir, write_report_file


def normalize_optional_bool(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    return None


async def run_research(payload):
    query = normalize_string(payload.get("query"))
    research_context = normalize_string(payload.get("context"))
    report_type = normalize_string(payload.get("reportType")) or "research_report"
    working_dir = resolve_working_dir(payload.get("workingDir"))
    use_local_docs = normalize_optional_bool(payload.get("useLocalDocs"))
    effective_use_local_docs = use_local_docs is not False
    working_files = list_working_dir_files(working_dir) if effective_use_local_docs else []
    if effective_use_local_docs and not working_files:
        effective_use_local_docs = False
    report_source = "hybrid" if effective_use_local_docs else "web"
    doc_path = working_dir if effective_use_local_docs else None

    if not query:
        write_json({
            "ok": False,
            "error": "query is required and must be a non-empty string.",
        })
        return 1

    started_at = time.time()
    log_buffer = io.StringIO()

    try:
        settings = load_settings()
        apply_settings(settings)
        if doc_path:
            os.environ["DOC_PATH"] = doc_path
        else:
            os.environ.pop("DOC_PATH", None)
        log_line(
            "[GPTResearcher/start_research] start "
            f"queryChars={len(query)} reportType={report_type} reportSource={report_source} "
            f"useLocalDocs={effective_use_local_docs} "
            f"fastLlm={settings['fastLlm']} smartLlm={settings['smartLlm']} "
            f"strategicLlm={settings['strategicLlm']} embedding={settings['embedding']} "
            f"searchProvider={settings['searchProvider']} retriever=search_agent"
        )
        patch_gpt_researcher_llm_providers()
        patch_gpt_researcher_retriever()
        from gpt_researcher import GPTResearcher

        researcher = GPTResearcher(
            query=query,
            report_type=report_type,
            report_source=report_source,
            context=[research_context] if research_context else None,
        )
        live_logs = LiveLogTee(log_buffer, sys.stderr)
        with contextlib.redirect_stdout(live_logs), contextlib.redirect_stderr(live_logs):
            log_line("[GPTResearcher/start_research] conduct_research started")
            await researcher.conduct_research()
            log_line("[GPTResearcher/start_research] conduct_research completed")
            log_line("[GPTResearcher/start_research] write_report started")
            report = await researcher.write_report(
                custom_prompt=research_context if research_context else ""
            )
            log_line("[GPTResearcher/start_research] write_report completed")
            report_path = write_report_file(working_dir, query, report)
            log_line(f"[GPTResearcher/start_research] report saved to {report_path}")

        write_json({
            "ok": True,
            "query": query,
            "context": research_context,
            "reportType": report_type,
            "reportSource": report_source,
            "useLocalDocs": effective_use_local_docs,
            "docPath": doc_path,
            "settings": settings,
            "report": report,
            "reportPath": report_path,
            "workingDir": working_dir,
            "workingFiles": working_files,
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
            "context": research_context,
            "reportType": report_type,
            "reportSource": locals().get("report_source"),
            "useLocalDocs": locals().get("effective_use_local_docs"),
            "docPath": locals().get("doc_path"),
            "settings": locals().get("settings"),
            "workingDir": locals().get("working_dir"),
            "workingFiles": locals().get("working_files"),
            "logTail": log_buffer.getvalue()[-16384:].strip(),
            "durationMs": int((time.time() - started_at) * 1000),
        })
        return 1
