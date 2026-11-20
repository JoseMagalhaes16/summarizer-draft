from __future__ import annotations

import json
import time
from typing import Any

import pytest

from vetscribe.container import Container
from vetscribe.handlers import api, worker
from vetscribe.jobs.dispatcher import InlineThreadDispatcher

from .conftest import make_event


class Ctx:
    function_name = "f"
    memory_limit_in_mb = 128
    invoked_function_arn = "arn:aws:lambda:us-east-1:1:function:f"
    aws_request_id = "r"


def call(
    method: str, path: str, body: Any = None, query: dict[str, str] | None = None
) -> tuple[int, Any, dict[str, str]]:
    res = api.lambda_handler(make_event(method, path, body, query), Ctx())  # type: ignore[arg-type]
    raw = res.get("body")
    return res["statusCode"], (json.loads(raw) if raw else None), res.get("headers", {})


TEMPLATE = {
    "name": "Mine",
    "description": "d",
    "appointment_type": "general",
    "sections": [
        {"id": "subjective", "title": "Subjective", "format": "paragraph"},
        {
            "id": "vitals",
            "title": "Vitals",
            "format": "key_value",
            "fields": [{"key": "weight", "label": "Weight"}],
        },
    ],
}


def wait_done(container: Container, note_id: str) -> dict[str, Any]:
    disp = container.dispatcher
    assert isinstance(disp, InlineThreadDispatcher)
    disp.join()
    status, body, _ = call("GET", f"/v1/notes/{note_id}")
    assert status == 200
    return body  # type: ignore[no-any-return]


def test_health(container: Container) -> None:
    status, body, headers = call("GET", "/v1/health")
    assert status == 200 and body == {"status": "ok", "llm_provider": "mock", "storage": "memory"}
    assert headers.get("Access-Control-Allow-Origin") == "*"


def test_unknown_route_and_preflight(container: Container) -> None:
    status, body, _ = call("GET", "/v1/nope")
    assert status == 404 and body["error"]["code"] == "NOT_FOUND"
    status, _, headers = call("OPTIONS", "/v1/templates")
    assert status in (200, 204)
    assert headers.get("Access-Control-Allow-Origin") == "*"
    assert "Content-Type" in headers.get("Access-Control-Allow-Headers", "")


def test_template_endpoints(container: Container) -> None:
    status, body, _ = call("GET", "/v1/templates")
    assert status == 200 and body["items"][0]["id"] == "builtin-soap"
    status, tpl, _ = call("POST", "/v1/templates", TEMPLATE)
    assert status == 201 and tpl["version"] == 1 and tpl["is_builtin"] is False
    tid = tpl["id"]
    assert call("GET", f"/v1/templates/{tid}")[0] == 200
    status, upd, _ = call("PUT", f"/v1/templates/{tid}", {**TEMPLATE, "name": "New"})
    assert status == 200 and upd["version"] == 2 and upd["name"] == "New"
    status, dup, _ = call("POST", f"/v1/templates/{tid}/duplicate", {})
    assert status == 201 and dup["name"] == "New (copy)"
    status, dup2, _ = call("POST", f"/v1/templates/{tid}/duplicate", {"name": "Zed"})
    assert dup2["name"] == "Zed"
    assert call("DELETE", f"/v1/templates/{tid}")[0] == 204
    assert call("GET", f"/v1/templates/{tid}")[0] == 404
    items = call("GET", "/v1/templates")[1]["items"]
    assert {i["id"] for i in items if not i["is_builtin"]} == {dup["id"], dup2["id"]}


def test_builtin_read_only(container: Container) -> None:
    status, body, _ = call("PUT", "/v1/templates/builtin-soap", TEMPLATE)
    assert status == 403 and body["error"]["code"] == "READ_ONLY"
    assert call("DELETE", "/v1/templates/builtin-soap")[0] == 403
    assert call("POST", "/v1/templates/builtin-soap/duplicate", None)[0] == 201
    assert call("POST", "/v1/templates/missing/duplicate", {})[0] == 404


def test_template_validation_errors(container: Container) -> None:
    bad = {**TEMPLATE, "sections": [{"id": "Bad Id", "title": "x"}]}
    status, body, _ = call("POST", "/v1/templates", bad)
    assert (
        status == 400 and body["error"]["code"] == "VALIDATION_ERROR" and body["error"]["details"]
    )
    dup_ids = {**TEMPLATE, "sections": [TEMPLATE["sections"][0], TEMPLATE["sections"][0]]}
    assert call("POST", "/v1/templates", dup_ids)[0] == 400
    kv = {**TEMPLATE, "sections": [{"id": "k", "title": "K", "format": "key_value"}]}
    assert call("POST", "/v1/templates", kv)[0] == 400
    assert call("POST", "/v1/templates", "{not json")[0] == 400
    assert call("POST", "/v1/templates", {"name": ""})[0] == 400


def test_note_end_to_end(container: Container, otitis: str) -> None:
    status, note, _ = call(
        "POST",
        "/v1/notes",
        {"template_id": "builtin-soap", "transcript": otitis, "patient": {"name": "Bella"}},
    )
    assert status == 202 and note["status"] in ("pending", "processing", "completed")
    assert "rendered_text" not in note
    done = wait_done(container, note["id"])
    assert done["status"] == "completed" and done["model_info"]["provider"] == "mock"
    assert "Physical Exam".upper() in done["rendered_text"]
    assert "## Subjective" in done["rendered_markdown"]
    assert [s["section_id"] for s in done["result"]["sections"]] == [
        s["id"] for s in done["template_snapshot"]["sections"]
    ]

    status, listing, _ = call("GET", "/v1/notes", query={"limit": "5"})
    assert status == 200 and listing["items"][0]["id"] == note["id"]
    assert listing["items"][0]["visit_summary"] and "transcript" not in listing["items"][0]
    assert call("GET", "/v1/notes", query={"limit": "abc"})[0] == 400

    result = done["result"]
    result["visit_summary"] = "Edited summary"
    status, edited, _ = call("PATCH", f"/v1/notes/{note['id']}", {"result": result})
    assert (
        status == 200 and edited["edited"] is True and "Edited summary" in edited["rendered_text"]
    )
    assert call("PATCH", f"/v1/notes/{note['id']}", {"result": {"sections": "x"}})[0] == 400

    status, regen, _ = call(
        "POST", f"/v1/notes/{note['id']}/regenerate", {"template_id": "builtin-sick"}
    )
    assert status == 202 and regen["result"] is None and regen["edited"] is False
    assert regen["template_id"] == "builtin-sick"
    assert wait_done(container, note["id"])["status"] == "completed"

    assert call("DELETE", f"/v1/notes/{note['id']}")[0] == 204
    assert call("GET", f"/v1/notes/{note['id']}")[0] == 404
    assert call("DELETE", f"/v1/notes/{note['id']}")[0] == 404
    assert call("PATCH", f"/v1/notes/{note['id']}", {"result": result})[0] == 404
    assert call("POST", f"/v1/notes/{note['id']}/regenerate", None)[0] == 404


def test_note_validation(container: Container) -> None:
    assert call("POST", "/v1/notes", {"template_id": "builtin-soap", "transcript": "   "})[0] == 400
    assert call("POST", "/v1/notes", {"transcript": "x"})[0] == 400
    assert call("POST", "/v1/notes", {"template_id": "nope", "transcript": "hello"})[0] == 404


def test_failed_note_shape(container: Container) -> None:
    class Boom:
        def generate(self, *a: Any, **k: Any) -> Any:
            raise RuntimeError("x")

    container._generator = Boom()  # type: ignore[assignment]
    container._note_service = None
    _, note, _ = call(
        "POST", "/v1/notes", {"template_id": "builtin-soap", "transcript": "hello there"}
    )
    done = wait_done(container, note["id"])
    assert done["status"] == "failed" and done["error"]["code"] == "INTERNAL"
    assert "rendered_text" not in done
    assert call("PATCH", f"/v1/notes/{note['id']}", {"result": {}})[0] == 409


def test_unhandled_error_is_500_without_leak(
    container: Container, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(*a: Any, **k: Any) -> Any:
        raise RuntimeError("secret detail")

    monkeypatch.setattr(container.template_service.__class__, "list", boom)
    status, body, _ = call("GET", "/v1/templates")
    assert (
        status == 500 and body["error"]["code"] == "INTERNAL" and "secret" not in json.dumps(body)
    )


def test_worker_handler(container: Container, otitis: str) -> None:
    note = container.note_service.create(
        "default",
        __import__("vetscribe.domain.models", fromlist=["CreateNoteRequest"]).CreateNoteRequest(
            template_id="builtin-soap", transcript=otitis
        ),
    )
    container.dispatcher.join()  # type: ignore[attr-defined]
    res = worker.lambda_handler({"note_id": note.id, "clinic_id": "default"}, Ctx())  # type: ignore[arg-type]
    assert res["ok"] is True
    time.sleep(0)
    assert container.note_service.get("default", note.id).status == "completed"
    assert worker.lambda_handler({"note_id": "x"}, Ctx())["ok"] is True  # type: ignore[arg-type]
