"""Local dev server: stdlib HTTP -> API Gateway HTTP API v2.0 event -> ``handlers.api``.

Run with ``python -m vetscribe.local.server [--host 127.0.0.1] [--port 8000]``.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlsplit

_LOCAL_DEFAULTS = {
    "APP_ENV": "local",
    "LLM_PROVIDER": "mock",
    "STORAGE_BACKEND": "memory",
    "JOB_DISPATCHER": "inline",
    "POWERTOOLS_METRICS_DISABLED": "true",
    "POWERTOOLS_METRICS_NAMESPACE": "VetScribe",
}


def apply_local_defaults() -> None:
    for key, value in _LOCAL_DEFAULTS.items():
        os.environ.setdefault(key, value)
    if "LOCAL_DATA_FILE" not in os.environ:
        backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
        os.environ["LOCAL_DATA_FILE"] = os.path.join(backend_dir, ".local-data.json")


class _FakeContext:
    function_name = "vetscribe-local"
    memory_limit_in_mb = 512
    invoked_function_arn = "arn:aws:lambda:local:000000000000:function:vetscribe-local"
    aws_request_id = "local"

    def get_remaining_time_in_millis(self) -> int:
        return 29_000


def build_event(method: str, target: str, headers: dict[str, str], body: bytes) -> dict[str, Any]:
    parts = urlsplit(target)
    lower = {k.lower(): v for k, v in headers.items()}
    query: dict[str, str] = {}
    if parts.query:
        from urllib.parse import parse_qsl

        for k, v in parse_qsl(parts.query, keep_blank_values=True):
            query[k] = f"{query[k]},{v}" if k in query else v
    now = time.time()
    return {
        "version": "2.0",
        "routeKey": "$default",
        "rawPath": parts.path,
        "rawQueryString": parts.query,
        "headers": lower,
        "queryStringParameters": query or None,
        "requestContext": {
            "accountId": "000000000000",
            "apiId": "local",
            "domainName": lower.get("host", "localhost"),
            "http": {
                "method": method,
                "path": parts.path,
                "protocol": "HTTP/1.1",
                "sourceIp": "127.0.0.1",
                "userAgent": lower.get("user-agent", ""),
            },
            "requestId": "local",
            "stage": "$default",
            "time": time.strftime("%d/%b/%Y:%H:%M:%S +0000", time.gmtime(now)),
            "timeEpoch": int(now * 1000),
        },
        "body": body.decode("utf-8", errors="replace") if body else None,
        "isBase64Encoded": False,
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "VetScribeLocal/1.0"

    def _handle(self) -> None:
        from vetscribe.handlers.api import lambda_handler

        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        event = build_event(self.command, self.path, dict(self.headers.items()), body)
        result = lambda_handler(event, _FakeContext())

        status = int(result.get("statusCode", 500))
        payload = (result.get("body") or "").encode("utf-8")
        self.send_response(status)
        sent = set()
        for k, v in (result.get("headers") or {}).items():
            self.send_header(k, str(v))
            sent.add(k.lower())
        for cookie in result.get("cookies") or []:
            self.send_header("Set-Cookie", cookie)
        for k, vals in (result.get("multiValueHeaders") or {}).items():
            if k.lower() not in sent:
                for v in vals:
                    self.send_header(k, v)
        if status != 204:
            self.send_header("Content-Length", str(len(payload)))
        else:
            self.send_header("Content-Length", "0")
            payload = b""
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = _handle

    def log_message(self, format: str, *args: Any) -> None:
        # Method + path only (no bodies, no query strings).
        sys.stderr.write(
            f"{self.command} {urlsplit(self.path).path} -> {args[1] if len(args) > 1 else ''}\n"
        )


def make_server(host: str = "127.0.0.1", port: int = 8000) -> ThreadingHTTPServer:
    apply_local_defaults()
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    return server


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="VetScribe local API server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args(argv)
    server = make_server(args.host, args.port)
    print(
        f"VetScribe local API on http://{args.host}:{args.port} "
        f"(llm={os.environ['LLM_PROVIDER']}, storage={os.environ['STORAGE_BACKEND']}, "
        f"data={os.environ.get('LOCAL_DATA_FILE', '-')})"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
