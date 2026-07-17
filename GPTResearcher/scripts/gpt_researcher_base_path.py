"""Fail-closed ASGI base-path adapter for the pinned GPT Researcher UI."""

from urllib.parse import urlsplit, urlunsplit

from main import app as upstream_app


BASE_PATH = "/services/gpt-researcher"
TEXT_TYPES = ("text/html", "text/css", "application/javascript", "text/javascript")
ROOT_REFERENCES = (
    (b'"/static/', b'"' + BASE_PATH.encode() + b'/static/'),
    (b"'/static/", b"'" + BASE_PATH.encode() + b'/static/'),
    (b'"/site/', b'"' + BASE_PATH.encode() + b'/site/'),
    (b"'/site/", b"'" + BASE_PATH.encode() + b'/site/'),
)


def rewrite_location(value, scope):
    """Keep same-origin absolute and root-relative redirects under BASE_PATH."""

    try:
        text = value.decode("latin1")
        parsed = urlsplit(text)
    except (UnicodeDecodeError, ValueError):
        return value

    host = next(
        (header_value.decode("latin1") for key, header_value in scope.get("headers", []) if key.lower() == b"host"),
        "",
    )
    scope_scheme = str(scope.get("scheme", "")).lower()
    if parsed.netloc:
        if not host or parsed.netloc.lower() != host.lower():
            return value
        if parsed.scheme and (parsed.scheme not in {"http", "https"} or parsed.scheme != scope_scheme):
            return value
    elif parsed.scheme:
        return value
    elif not parsed.path.startswith("/"):
        return value

    if parsed.path == BASE_PATH or parsed.path.startswith(BASE_PATH + "/"):
        return value
    rewritten_path = BASE_PATH + (parsed.path if parsed.path.startswith("/") else "/" + parsed.path)
    return urlunsplit((parsed.scheme, parsed.netloc, rewritten_path, parsed.query, parsed.fragment)).encode("latin1")


class StreamingBodyRewriter:
    """Rewrite root references without buffering a complete response."""

    def __init__(self):
        self.pending = bytearray()

    def feed(self, body, final=False):
        self.pending.extend(body)
        output = bytearray()
        while self.pending:
            matched = False
            for old, new in ROOT_REFERENCES:
                if self.pending.startswith(old):
                    output.extend(new)
                    del self.pending[:len(old)]
                    matched = True
                    break
            if matched:
                continue
            if not final and any(old.startswith(self.pending) for old, _new in ROOT_REFERENCES):
                break
            output.append(self.pending[0])
            del self.pending[0]
        return bytes(output)


class BasePathApp:
    def __init__(self, wrapped):
        self.wrapped = wrapped

    async def __call__(self, scope, receive, send):
        if scope["type"] not in {"http", "websocket"}:
            await self.wrapped(scope, receive, send)
            return

        path = scope.get("path", "")
        if path != BASE_PATH and not path.startswith(BASE_PATH + "/"):
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008, "reason": "route outside service base path"})
            else:
                await send({
                    "type": "http.response.start",
                    "status": 404,
                    "headers": [(b"content-type", b"text/plain; charset=utf-8"), (b"cache-control", b"no-store")],
                })
                await send({"type": "http.response.body", "body": b"not found"})
            return

        child_scope = dict(scope)
        child_scope["root_path"] = BASE_PATH
        child_scope["path"] = path[len(BASE_PATH):] or "/"
        raw_path = scope.get("raw_path")
        if raw_path is not None:
            encoded_base = BASE_PATH.encode()
            child_scope["raw_path"] = raw_path[len(encoded_base):] or b"/"

        if scope["type"] == "websocket":
            await self.wrapped(child_scope, receive, send)
            return

        response_started = False
        body_rewriter = None

        async def streaming_send(message):
            nonlocal response_started, body_rewriter
            if message["type"] == "http.response.start":
                if response_started:
                    raise RuntimeError("upstream emitted duplicate response metadata")
                response_started = True
                start = dict(message)
                headers = list(start.get("headers", []))
                content_type = next(
                    (value.decode("latin1").lower() for key, value in headers if key.lower() == b"content-type"),
                    "",
                )
                rewrite_body = any(content_type.startswith(value) for value in TEXT_TYPES)
                rewritten = []
                for key, value in headers:
                    lower = key.lower()
                    if rewrite_body and lower == b"content-length":
                        continue
                    if lower == b"location":
                        value = rewrite_location(value, scope)
                    rewritten.append((key, value))
                start["headers"] = rewritten
                body_rewriter = StreamingBodyRewriter() if rewrite_body else None
                await send(start)
                return
            if message["type"] == "http.response.body":
                if not response_started:
                    raise RuntimeError("upstream returned a response body without response metadata")
                more_body = bool(message.get("more_body", False))
                body = message.get("body", b"")
                if body_rewriter is not None:
                    body = body_rewriter.feed(body, final=not more_body)
                await send({
                    **message,
                    "body": body,
                    "more_body": more_body,
                })
                return
            await send(message)

        await self.wrapped(child_scope, receive, streaming_send)


app = BasePathApp(upstream_app)
