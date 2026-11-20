from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from collections.abc import Iterator
from typing import Any

import pytest

from vetscribe.container import set_container
from vetscribe.local import server as local_server


@pytest.fixture
def base_url(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> Iterator[str]:
    monkeypatch.setenv("LOCAL_DATA_FILE", str(tmp_path / "d.json"))
    monkeypatch.setenv("MOCK_LATENCY_SECONDS", "0")
    set_container(None)
    srv = local_server.make_server("127.0.0.1", 0)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()
    srv.server_close()
    set_container(None)


def req(url: str, method: str = "GET", body: Any = None) -> tuple[int, Any, Any]:
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json", "Origin": "http://localhost:5173"},
    )
    try:
        with urllib.request.urlopen(r, timeout=5) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None), resp.headers
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, (json.loads(raw) if raw else None), e.headers


def test_health_and_cors(base_url: str) -> None:
    status, body, headers = req(f"{base_url}/v1/health")
    assert status == 200 and body["status"] == "ok"
    assert headers["Access-Control-Allow-Origin"] == "*"
    status, _, headers = req(f"{base_url}/v1/notes", "OPTIONS")
    assert status in (200, 204) and headers["Access-Control-Allow-Origin"] == "*"


def test_full_flow_over_http(base_url: str) -> None:
    import time

    status, note, _ = req(
        f"{base_url}/v1/notes",
        "POST",
        {"template_id": "builtin-soap", "transcript": "The dog has itchy ears for two weeks."},
    )
    assert status == 202
    for _ in range(50):
        status, got, _ = req(f"{base_url}/v1/notes/{note['id']}")
        if got["status"] == "completed":
            break
        time.sleep(0.05)
    assert got["status"] == "completed"
    assert req(f"{base_url}/v1/notes/{note['id']}", "DELETE")[0] == 204
    assert req(f"{base_url}/v1/missing")[0] == 404


def test_build_event_shape() -> None:
    ev = local_server.build_event(
        "POST", "/v1/notes?limit=3&a=1&a=2", {"Content-Type": "x"}, b'{"a":1}'
    )
    assert ev["version"] == "2.0" and ev["rawPath"] == "/v1/notes"
    assert ev["rawQueryString"] == "limit=3&a=1&a=2" and ev["headers"] == {"content-type": "x"}
    assert ev["requestContext"]["http"]["method"] == "POST" and ev["isBase64Encoded"] is False
    assert ev["queryStringParameters"] == {"limit": "3", "a": "1,2"}
    assert local_server.build_event("GET", "/", {}, b"")["body"] is None
