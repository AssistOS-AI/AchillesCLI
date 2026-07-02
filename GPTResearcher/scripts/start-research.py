#!/usr/bin/env python3

import asyncio
import sys

from gpt_researcher_agent.io_utils import parse_input, write_json
from gpt_researcher_agent.research import run_research


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
