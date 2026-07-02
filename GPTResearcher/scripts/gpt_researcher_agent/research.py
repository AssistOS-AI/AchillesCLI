import contextlib
import io
import sys
import time
import traceback

from .io_utils import LiveLogTee, log_line, normalize_string, optional_call, write_json
from .settings import apply_settings, build_research_query, load_settings
from .soul_gateway import patch_gpt_researcher_llm_providers
from .workspace_files import build_files_context, list_working_dir_files, resolve_working_dir, write_report_file


async def run_research(payload):
    query = normalize_string(payload.get("query"))
    more_context = normalize_string(payload.get("moreContext"))
    report_type = normalize_string(payload.get("reportType")) or "research_report"
    working_dir = resolve_working_dir(payload.get("workingDir"))
    working_files = list_working_dir_files(working_dir)
    files_context = build_files_context(working_files)

    if not query:
        write_json({
            "ok": False,
            "error": "query is required and must be a non-empty string.",
        })
        return 1

    started_at = time.time()
    effective_query = build_research_query(query, more_context, files_context)
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
        patch_gpt_researcher_llm_providers()
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
            report_path = write_report_file(working_dir, query, report)
            log_line(f"[GPTResearcher/start_research] report saved to {report_path}")

        write_json({
            "ok": True,
            "query": query,
            "moreContext": more_context,
            "reportType": report_type,
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
            "moreContext": more_context,
            "reportType": report_type,
            "settings": locals().get("settings"),
            "workingDir": locals().get("working_dir"),
            "workingFiles": locals().get("working_files"),
            "logTail": log_buffer.getvalue()[-16384:].strip(),
            "durationMs": int((time.time() - started_at) * 1000),
        })
        return 1
