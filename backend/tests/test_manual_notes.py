from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from vetscribe.config import Settings
from vetscribe.container import Container, set_container
from vetscribe.domain.builtin_templates import get_builtin
from vetscribe.domain.models import Note, NoteSummary, Template
from vetscribe.evals.service import InlineEvalDispatcher
from vetscribe.services.notes import build_blank_result

from .test_api import call


def soap_template() -> Template:
    t = get_builtin("builtin-soap")
    assert t is not None
    return t


@pytest.fixture
def ai_off(tmp_path: Path) -> Iterator[Container]:
    c = Container(
        Settings(mock_latency_seconds=0.0, llm_provider="none", eval_results_dir=str(tmp_path))
    )
    set_container(c)
    yield c
    disp = c.eval_service.dispatcher
    assert isinstance(disp, InlineEvalDispatcher)
    disp.join()
    set_container(None)


def manual(body: dict[str, Any] | None = None) -> tuple[int, Any]:
    payload = {"template_id": "builtin-soap", **(body or {})}
    status, data, _ = call("POST", "/v1/notes/manual", payload)
    return status, data


def test_manual_blank(container: Container) -> None:
    status, note = manual({"patient": {"name": "Rex"}, "clinician": "Dr A"})
    assert status == 201
    assert note["status"] == "completed" and note["source"] == "manual"
    assert note["generation_id"] and note["model_info"] is None and note["error"] is None
    assert note["edited"] is False and note["transcript"] == ""
    assert note["template_snapshot"]["id"] == "builtin-soap"
    res = note["result"]
    assert res["visit_summary"] == "" and res["action_items"] == [] and res["review_flags"] == []
    assert all(s["not_discussed"] and not s["used_defaults"] for s in res["sections"])
    assert "rendered_text" in note and "rendered_markdown" in note
    got = call("GET", f"/v1/notes/{note['id']}")[1]
    assert got["source"] == "manual" and got["rendered_text"] == note["rendered_text"]


def test_manual_with_result_and_patch(container: Container) -> None:
    result = build_blank_result(soap_template()).model_dump(mode="json")
    result["visit_summary"] = "Ear check"
    result["sections"][0]["content"] = "Scratching ears"
    result["sections"][0]["not_discussed"] = False
    status, note = manual({"result": result, "prefill_defaults": True})
    assert status == 201 and note["result"]["visit_summary"] == "Ear check"
    assert not any(s["used_defaults"] for s in note["result"]["sections"])  # prefill ignored
    assert "Scratching ears" in note["rendered_text"]

    result["visit_summary"] = "Edited"
    status, patched, _ = call("PATCH", f"/v1/notes/{note['id']}", {"result": result})
    assert status == 200 and patched["edited"] is True and patched["source"] == "manual"
    assert patched["result"]["review_flags"] == []  # no automatic flags


def test_manual_prefill_defaults(container: Container) -> None:
    status, note = manual({"template_id": "builtin-wellness", "prefill_defaults": True})
    assert status == 201
    tpl = note["template_snapshot"]["sections"]
    seen = 0
    for spec, sec in zip(tpl, note["result"]["sections"], strict=True):
        wants = bool(
            spec["missing_behavior"] == "use_normal_defaults"
            and spec["normal_defaults"].strip()
            and spec["format"] in ("paragraph", "bullets")
        )
        assert sec["used_defaults"] is wants
        assert sec["not_discussed"] is (not wants)
        if wants:
            seen += 1
            text = sec["content"] or " ".join(sec["items"])
            assert text == spec["normal_defaults"].strip()
    assert seen > 0


def test_blank_builder_bullets_and_key_value() -> None:
    tpl = Template.model_validate(
        {
            "id": "t",
            "name": "T",
            "sections": [
                {
                    "id": "b",
                    "title": "B",
                    "format": "bullets",
                    "missing_behavior": "use_normal_defaults",
                    "normal_defaults": "Normal",
                },
                {
                    "id": "k",
                    "title": "K",
                    "format": "key_value",
                    "fields": [{"key": "w", "label": "W"}],
                    "missing_behavior": "use_normal_defaults",
                    "normal_defaults": "ignored",
                },
            ],
        }
    )
    r = build_blank_result(tpl, prefill_defaults=True)
    assert r.sections[0].items == ["Normal"] and r.sections[0].used_defaults
    assert r.sections[1].not_discussed and r.sections[1].fields[0].value == ""


def test_manual_mismatch_404_413_validation(container: Container) -> None:
    result = build_blank_result(soap_template()).model_dump(mode="json")
    result["sections"].pop()
    status, body = manual({"result": result})
    assert status == 400 and body["error"]["code"] == "VALIDATION_ERROR"
    assert manual({"template_id": "nope"})[0] == 404
    assert manual({"template_id": ""})[0] == 400
    assert manual({"transcript": "x" * 300_001})[0] == 400

    status, tpl, _ = call(
        "POST",
        "/v1/templates",
        {"name": "Big", "sections": [{"id": f"s{i}", "title": f"S{i}"} for i in range(30)]},
    )
    assert status == 201
    big = {
        "visit_summary": "",
        "action_items": [],
        "review_flags": [],
        "sections": [
            {
                "section_id": f"s{i}",
                "title": f"S{i}",
                "format": "paragraph",
                "content": "x" * 20_000,
            }
            for i in range(30)
        ],
    }
    status, body = manual({"template_id": tpl["id"], "result": big})
    assert status == 413 and body["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_manual_transcript_char_limit(settings: Settings) -> None:
    c = Container(settings.with_overrides(max_transcript_chars=5))
    set_container(c)
    try:
        assert manual({"transcript": "abcdefgh"})[0] == 400
        assert manual({"transcript": "abc"})[0] == 201
    finally:
        set_container(None)


def test_manual_transcript_stored(container: Container) -> None:
    status, note = manual({"transcript": "Dr: hello"})
    assert status == 201 and note["transcript"] == "Dr: hello"
    assert call("GET", f"/v1/notes/{note['id']}")[1]["transcript"] == "Dr: hello"
    status, blank = manual({"transcript": "   "})
    assert status == 201 and blank["transcript"] == ""


def test_regenerate_manual_conflicts(container: Container) -> None:
    note = manual()[1]
    status, body, _ = call("POST", f"/v1/notes/{note['id']}/regenerate", {})
    assert status == 409 and body["error"]["code"] == "MANUAL_NOTE"
    assert call("GET", f"/v1/notes/{note['id']}")[1]["status"] == "completed"


def test_list_includes_source(container: Container) -> None:
    manual_note = manual()[1]
    status, ai, _ = call("POST", "/v1/notes", {"template_id": "builtin-soap", "transcript": "hi"})
    assert status == 202
    container.dispatcher.join()  # type: ignore[attr-defined]
    items = call("GET", "/v1/notes")[1]["items"]
    by_id = {i["id"]: i for i in items}
    assert by_id[manual_note["id"]]["source"] == "manual" and by_id[ai["id"]]["source"] == "ai"
    assert set(items[0]) == {
        "id", "template_id", "template_name", "patient", "status", "source",
        "visit_summary", "created_at", "updated_at",
    }  # fmt: skip


def test_repo_roundtrip_and_legacy(any_repo: Any) -> None:
    soap = soap_template()
    n = Note(
        id="01M",
        template_id=soap.id,
        template_name=soap.name,
        template_snapshot=soap,
        transcript="",
        generation_id="g",
        status="completed",
        result=build_blank_result(soap),
        source="manual",
    )
    any_repo.put_note("c", n)
    got = any_repo.get_note("c", "01M")
    assert got.source == "manual" and got.transcript == ""
    assert any_repo.list_note_summaries("c")[0].source == "manual"

    # A legacy stored item has no `source` anywhere.
    any_repo.put_note("c", n.model_copy(update={"id": "01L", "source": "ai"}))
    if hasattr(any_repo, "raw_table"):
        key = {"PK": "CLINIC#c", "SK": "NOTE#01L"}
        item = any_repo.raw_table.get_item(Key=key)["Item"]
        doc = json.loads(item["data"])
        del doc["source"]
        item["data"] = json.dumps(doc)
        del item["source"]
        any_repo.raw_table.put_item(Item=item)
    else:
        del any_repo._notes["c"]["01L"]["source"]
    assert any_repo.get_note("c", "01L").source == "ai"
    by_id = {s.id: s for s in any_repo.list_note_summaries("c")}
    assert isinstance(by_id["01L"], NoteSummary) and by_id["01L"].source == "ai"


def test_ai_off_health_and_create(ai_off: Container) -> None:
    assert ai_off.generator is None
    body = call("GET", "/v1/health")[1]
    assert body["ai_enabled"] is False and body["llm_provider"] == "none"
    status, err, _ = call("POST", "/v1/notes", {"template_id": "builtin-soap", "transcript": "hi"})
    assert status == 409 and err["error"]["code"] == "AI_DISABLED"
    assert "Write the note manually" in err["error"]["message"]

    status, note = manual()
    assert status == 201
    status, err, _ = call("POST", f"/v1/notes/{note['id']}/regenerate", {})
    assert status == 409 and err["error"]["code"] == "AI_DISABLED"
    assert call("GET", "/v1/templates")[0] == 200
    assert len(call("GET", "/v1/notes")[1]["items"]) == 1


def test_ai_off_evals(ai_off: Container) -> None:
    for provider in ("mock", "bedrock"):
        status, err, _ = call("POST", "/v1/evals/runs", {"provider": provider})
        assert status == 409 and err["error"]["code"] == "AI_DISABLED"
    status, data, _ = call("POST", "/v1/evals/runs", {"provider": "oracle", "reps": 1})
    assert status == 202, data


def test_health_ai_enabled_true(container: Container) -> None:
    assert call("GET", "/v1/health")[1]["ai_enabled"] is True


def test_config_accepts_none() -> None:
    assert Settings.from_env({"LLM_PROVIDER": "none"}).llm_provider == "none"


def test_process_without_generator_fails_note(ai_off: Container) -> None:
    soap = soap_template()
    ai_off.repository.put_note(
        "default",
        Note(
            id="01P",
            template_id=soap.id,
            template_name=soap.name,
            template_snapshot=soap,
            transcript="t",
            generation_id="g",
        ),
    )
    ai_off.note_service.process("01P", "default", "g")
    done = ai_off.repository.get_note("default", "01P")
    assert done is not None and done.status == "failed"
