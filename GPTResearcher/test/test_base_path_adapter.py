import asyncio
import importlib.util
import pathlib
import sys
import types
import unittest


ADAPTER_PATH = pathlib.Path(__file__).parents[1] / "scripts" / "gpt_researcher_base_path.py"


def load_adapter(upstream):
    main_module = types.ModuleType("main")
    main_module.app = upstream
    sys.modules["main"] = main_module
    spec = importlib.util.spec_from_file_location("gpt_researcher_base_path_tested", ADAPTER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def empty_receive():
    return {"type": "http.disconnect"}


class BasePathAdapterTests(unittest.TestCase):
    def test_same_origin_absolute_and_root_redirects_stay_under_base_path(self):
        async def run(location):
            downstream = []

            async def collect(message):
                downstream.append(message)

            async def upstream(_scope, _receive, send):
                await send({
                    "type": "http.response.start",
                    "status": 307,
                    "headers": [(b"location", location)],
                })
                await send({"type": "http.response.body", "body": b""})

            module = load_adapter(upstream)
            scope = {
                "type": "http",
                "scheme": "https",
                "path": module.BASE_PATH + "/site",
                "raw_path": (module.BASE_PATH + "/site").encode(),
                "headers": [(b"host", b"research.example")],
            }
            await module.BasePathApp(upstream)(scope, empty_receive, collect)
            return dict(downstream[0]["headers"])[b"location"]

        self.assertEqual(
            asyncio.run(run(b"/site/")),
            b"/services/gpt-researcher/site/",
        )
        self.assertEqual(
            asyncio.run(run(b"https://research.example/site/?view=all#top")),
            b"https://research.example/services/gpt-researcher/site/?view=all#top",
        )
        self.assertEqual(
            asyncio.run(run(b"//research.example/site/")),
            b"//research.example/services/gpt-researcher/site/",
        )
        self.assertEqual(
            asyncio.run(run(b"http://research.example/site/")),
            b"http://research.example/site/",
        )
        self.assertEqual(
            asyncio.run(run(b"https://elsewhere.example/site/")),
            b"https://elsewhere.example/site/",
        )

    def test_event_stream_is_forwarded_before_upstream_completion(self):
        downstream = []

        async def collect(message):
            downstream.append(message)

        async def upstream(_scope, _receive, send):
            await send({
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"content-type", b"text/event-stream")],
            })
            await send({"type": "http.response.body", "body": b"data: first\n\n", "more_body": True})
            self.assertEqual(downstream[-1]["body"], b"data: first\n\n")
            await send({"type": "http.response.body", "body": b"data: second\n\n", "more_body": False})

        module = load_adapter(upstream)
        scope = {"type": "http", "path": module.BASE_PATH + "/stream", "raw_path": (module.BASE_PATH + "/stream").encode()}
        asyncio.run(module.BasePathApp(upstream)(scope, empty_receive, collect))
        self.assertEqual([item["type"] for item in downstream], [
            "http.response.start",
            "http.response.body",
            "http.response.body",
        ])

    def test_text_rewrite_handles_a_reference_split_across_chunks(self):
        downstream = []

        async def collect(message):
            downstream.append(message)

        async def upstream(_scope, _receive, send):
            await send({
                "type": "http.response.start",
                "status": 200,
                "headers": [(b"content-type", b"text/html"), (b"content-length", b"22")],
            })
            await send({"type": "http.response.body", "body": b'<script src="/sta', "more_body": True})
            await send({"type": "http.response.body", "body": b'tic/app.js">', "more_body": False})

        module = load_adapter(upstream)
        scope = {"type": "http", "path": module.BASE_PATH + "/", "raw_path": (module.BASE_PATH + "/").encode()}
        asyncio.run(module.BasePathApp(upstream)(scope, empty_receive, collect))
        headers = dict(downstream[0]["headers"])
        self.assertNotIn(b"content-length", headers)
        body = b"".join(item.get("body", b"") for item in downstream[1:])
        self.assertEqual(body, b'<script src="/services/gpt-researcher/static/app.js">')

    def test_outside_path_fails_before_upstream(self):
        called = False

        async def upstream(_scope, _receive, _send):
            nonlocal called
            called = True

        module = load_adapter(upstream)
        downstream = []

        async def collect(message):
            downstream.append(message)

        scope = {"type": "http", "path": "/admin", "raw_path": b"/admin"}
        asyncio.run(module.BasePathApp(upstream)(scope, empty_receive, collect))
        self.assertFalse(called)
        self.assertEqual(downstream[0]["status"], 404)


if __name__ == "__main__":
    unittest.main()
