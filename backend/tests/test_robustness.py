"""Concurrency, failure-handling, size-limit and read-path safety-net behaviour."""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from vetscribe.config import Settings
from vetscribe.container import Container, set_container
from vetscribe.domain.models import CreateNoteRequest, Note, NoteError, NoteResult, Patient
from vetscribe.errors import AppError, PayloadTooLargeError
from vetscribe.handlers import dlq
from vetscribe.jobs.dispatcher import InlineThreadDispatcher
from vetscribe.llm.base import GenerationResult
from vetscribe.llm.mock import MockNoteGenerator
from vetscribe.repositories.memory import MemoryRepository
from vetscribe.services.notes import NoteService

from .test_api import Ctx, call

C = "default"


class SyncDispatcher:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []

    def dispatch(self, note_id: str, clinic_id: str, generation_id: str) -> None:
        self.calls.append((note_id, clinic_id, generation_id))


class HookGenerator:
    """Mock generator that runs a callback while 'generating' (simulates concurrent activity)."""

    def __init__(self, hook: Callable[[], None] | None = None, raw: dict[str, Any] | None = None):
        self.hook, self.raw, self.deadlines = hook, raw, []  # type: ignore[var-annotated]

    def generate(
        self,
        template: Any,
        transcript: str,
        patient: Any,
        clinician: str = "",
        deadline: float | None = None,
    ) -> GenerationResult:
        self.deadlines.append(deadline)
        if self.hook:
            self.hook()
        res = MockNoteGenerator(0).generate(template, transcript, patient, clinician)
        return GenerationResult(self.raw or res.raw, res.model_info)


def make(repo: Any, gen: Any | None = None, **overrides: Any) -> tuple[Container, SyncDispatcher]:
    disp = SyncDispatcher()
    c = Container(
        Settings(mock_latency_seconds=0, **overrides),
        repository=repo,
        generator=gen or HookGenerator(),
        dispatcher=disp,
    )
    return c, disp


def new_note(c: Container, text: str = "She has been scratching her ears for two weeks.") -> Note:
    return c.note_service.create(C, CreateNoteRequest(template_id="builtin-soap", transcript=text))


def age(repo: Any, note_id: str, seconds: int) -> None:
    """Make a stored note look ``seconds`` old (without touching the generation id)."""
    note = repo.get_note(C, note_id)
    note.updated_at = (datetime.now(UTC) - timedelta(seconds=seconds)).strftime(
        "%Y-%m-%dT%H:%M:%S.%fZ"
    )
    assert repo.save_if_generation(C, note, note.generation_id)


# ---- 1. concurrent regenerate / stale writes ------------------------------------------------


def test_regenerate_while_active_is_409(any_repo: Any) -> None:
    c, _ = make(any_repo)
    note = new_note(c)
    for status in ("pending", "processing"):
        n = any_repo.get_note(C, note.id)
        n.status = status
        any_repo.put_note(C, n)
        with pytest.raises(AppError) as ei:
            c.note_service.regenerate(C, note.id)
        assert ei.value.status == 409 and ei.value.code == "GENERATION_IN_PROGRESS"


def test_regenerate_api_409(container: Container) -> None:
    container._dispatcher = SyncDispatcher()  # type: ignore[assignment]
    container._note_service = None
    _, note, _ = call("POST", "/v1/notes", {"template_id": "builtin-soap", "transcript": "hello x"})
    status, body, _ = call("POST", f"/v1/notes/{note['id']}/regenerate", {})
    assert status == 409 and body["error"]["code"] == "GENERATION_IN_PROGRESS"


def test_regenerate_race_loses_conditional_write(any_repo: Any) -> None:
    """Two regenerates both pass the status check; only one conditional write wins."""
    c, disp = make(any_repo)
    note = new_note(c)
    c.note_service.process(note.id, C, note.generation_id or "")
    real = any_repo.save_if_generation

    def sneaky(clinic: str, n: Note, expected: str | None) -> bool:
        # Another request regenerates between our read and our write.
        other = any_repo.get_note(clinic, n.id)
        other.generation_id = "someone-else"
        other.status = "pending"
        any_repo.put_note(clinic, other)
        return real(clinic, n, expected)  # type: ignore[no-any-return]

    any_repo.save_if_generation = sneaky
    with pytest.raises(AppError) as ei:
        c.note_service.regenerate(C, note.id)
    assert ei.value.code == "GENERATION_IN_PROGRESS"
    assert len(disp.calls) == 1  # no second dispatch
    any_repo.delete_note(C, note.id)
    with pytest.raises(AppError) as ei2:
        c.note_service.regenerate(C, note.id)
    assert ei2.value.status == 404


def test_stale_generation_write_is_skipped(any_repo: Any) -> None:
    holder: dict[str, Any] = {}

    def hook() -> None:
        # While the old generation runs it is declared dead and the user regenerates.
        if "new" in holder:
            return
        svc: NoteService = holder["svc"]
        nid, gid = holder["id"], holder["gid"]
        assert svc.mark_failed(C, nid, gid, NoteError(code="GENERATION_TIMEOUT", message="x"))
        holder["new"] = svc.regenerate(C, nid)

    c, disp = make(any_repo, HookGenerator(hook))
    note = new_note(c)
    holder.update(svc=c.note_service, id=note.id, gid=note.generation_id)
    c.note_service.process(note.id, C, note.generation_id or "")
    stored = any_repo.get_note(C, note.id)
    assert stored.generation_id == holder["new"].generation_id != note.generation_id
    assert stored.status == "pending" and stored.result is None and stored.error is None
    assert len(disp.calls) == 2
    # The superseded dispatch is a no-op at the start as well.
    c.note_service.process(note.id, C, note.generation_id or "")
    assert any_repo.get_note(C, note.id).status == "pending"
    # ... while the current one completes.
    c.note_service.process(note.id, C, stored.generation_id or "")
    assert any_repo.get_note(C, note.id).status == "completed"


def test_deleted_while_processing(any_repo: Any) -> None:
    holder: dict[str, Any] = {}
    c, _ = make(any_repo, HookGenerator(lambda: holder["svc"].delete(C, holder["id"])))
    note = new_note(c)
    holder.update(svc=c.note_service, id=note.id)
    c.note_service.process(note.id, C, note.generation_id or "")
    assert any_repo.get_note(C, note.id) is None  # not resurrected by the final write
    assert any_repo.list_note_summaries(C) == []


def test_patch_conditional_on_generation(any_repo: Any) -> None:
    c, _ = make(any_repo)
    note = new_note(c)
    c.note_service.process(note.id, C, note.generation_id or "")
    done = c.note_service.get(C, note.id)
    assert done.result
    real = any_repo.save_if_generation

    def regen_first(clinic: str, n: Note, expected: str | None) -> bool:
        other = any_repo.get_note(clinic, n.id)
        other.generation_id = "new"
        any_repo.put_note(clinic, other)
        return real(clinic, n, expected)  # type: ignore[no-any-return]

    any_repo.save_if_generation = regen_first
    with pytest.raises(AppError) as ei:
        c.note_service.update_result(C, note.id, done.result)
    assert ei.value.status == 409 and ei.value.code == "NOTE_CHANGED"
    any_repo.delete_note(C, note.id)
    with pytest.raises(AppError) as ei2:
        c.note_service.update_result(C, note.id, done.result)
    assert ei2.value.status == 404


def test_dispatch_failure_is_conditional(any_repo: Any) -> None:
    class Boom:
        def dispatch(self, *a: str) -> None:
            raise RuntimeError

    c = Container(Settings(), repository=any_repo, generator=HookGenerator(), dispatcher=Boom())
    note = new_note(c)
    assert any_repo.get_note(C, note.id).status == "failed"


# ---- repository contract --------------------------------------------------------------------


def test_save_if_generation_contract(any_repo: Any, soap: Any) -> None:
    n = Note(
        id="01", template_id="x", template_name="x", template_snapshot=soap, transcript="t",
        generation_id="g1",
    )  # fmt: skip
    assert any_repo.save_if_generation(C, n, "g1") is False  # does not exist yet
    any_repo.put_note(C, n)
    n.status = "processing"
    assert any_repo.save_if_generation(C, n, "g2") is False
    assert any_repo.get_note(C, "01").status == "pending"
    assert any_repo.save_if_generation(C, n, "g1") is True
    assert any_repo.get_note(C, "01").status == "processing"
    legacy = n.model_copy(update={"id": "02", "generation_id": None})
    assert any_repo.save_if_generation(C, legacy, None) is False  # missing item is not resurrected
    any_repo.put_note(C, legacy)
    assert any_repo.save_if_generation(C, legacy, None) is True
    assert any_repo.save_if_generation(C, legacy, "g1") is False


def test_transcript_stored_separately_and_list_excludes_it(any_repo: Any, soap: Any) -> None:
    big = "é" * 140_000  # 280 000 bytes: only fits because the transcript has its own item
    n = Note(
        id="01", template_id=soap.id, template_name=soap.name, template_snapshot=soap,
        transcript=big, patient=Patient(name="Bella"), generation_id="g",
    )  # fmt: skip
    any_repo.put_note(C, n)
    assert any_repo.get_note(C, "01").transcript == big
    summaries = any_repo.list_note_summaries(C)
    assert [s.id for s in summaries] == ["01"] and summaries[0].patient.name == "Bella"
    assert summaries[0].visit_summary is None
    if hasattr(any_repo, "raw_table"):
        items = any_repo.raw_table.scan()["Items"]
        by_sk = {i["SK"]: i for i in items}
        assert set(by_sk) == {"NOTE#01", "NOTETX#01"}
        assert "transcript" not in json.loads(by_sk["NOTE#01"]["data"])
        assert by_sk["NOTETX#01"]["transcript"] == big
        assert by_sk["NOTE#01"]["generation_id"] == "g" and by_sk["NOTE#01"]["status"] == "pending"
    assert any_repo.delete_note(C, "01") is True
    if hasattr(any_repo, "raw_table"):
        assert any_repo.raw_table.scan()["Items"] == []
    assert any_repo.get_note(C, "01") is None


def test_list_summaries_pagination_and_visit_summary(any_repo: Any, soap: Any) -> None:
    for i in range(5):
        n = Note(
            id=f"0{i}", template_id=soap.id, template_name=soap.name, template_snapshot=soap,
            transcript="t", status="completed",
            result=NoteResult(visit_summary=f"sum {i}"),
        )  # fmt: skip
        any_repo.put_note(C, n)
    got = any_repo.list_note_summaries(C, limit=3)
    assert [g.visit_summary for g in got] == ["sum 4", "sum 3", "sum 2"]


def test_item_size_limit(any_repo: Any, soap: Any) -> None:
    sections = [
        {"section_id": s.id, "title": s.title, "format": "paragraph", "content": "x" * 20_000}
        for s in soap.sections
    ] * 5  # 25 sections x 20 000 chars is over the 380 000 byte budget
    big = NoteResult.model_validate({"sections": sections})
    n = Note(
        id="01", template_id=soap.id, template_name=soap.name, template_snapshot=soap,
        transcript="t", generation_id="g", status="completed", result=big,
    )  # fmt: skip
    with pytest.raises(PayloadTooLargeError):
        any_repo.put_note(C, n)
    small = n.model_copy(update={"result": None})
    any_repo.put_note(C, small)
    with pytest.raises(PayloadTooLargeError):
        any_repo.save_if_generation(C, n, "g")
    huge_tx = n.model_copy(update={"result": None, "transcript": "x" * 390_000})
    with pytest.raises(PayloadTooLargeError):
        any_repo.put_note(C, huge_tx)


def test_final_save_too_large_marks_failed() -> None:
    class TinyRepo(MemoryRepository):
        def save_if_generation(self, clinic_id: str, note: Note, expected: str | None) -> bool:
            if note.status == "completed":
                raise PayloadTooLargeError()
            return super().save_if_generation(clinic_id, note, expected)

    c, _ = make(TinyRepo())
    note = new_note(c)
    c.note_service.process(note.id, C, note.generation_id or "")
    failed = c.repository.get_note(C, note.id)
    assert failed and failed.status == "failed" and failed.error
    assert failed.error.code == "PAYLOAD_TOO_LARGE" and failed.result is None


def test_patch_too_large_is_413(container: Container) -> None:
    status, tpl, _ = call(
        "POST",
        "/v1/templates",
        {
            "name": "Big",
            "sections": [{"id": f"s{i}", "title": f"S{i}"} for i in range(30)],
        },
    )
    assert status == 201
    status, note, _ = call(
        "POST", "/v1/notes", {"template_id": tpl["id"], "transcript": "She scratches her ears."}
    )
    container.dispatcher.join()  # type: ignore[attr-defined]
    done = call("GET", f"/v1/notes/{note['id']}")[1]
    assert done["status"] == "completed"
    result = done["result"]
    for sec in result["sections"]:
        sec["content"] = "x" * 20_000
    status, body, _ = call("PATCH", f"/v1/notes/{note['id']}", {"result": result})
    assert status == 413 and body["error"]["code"] == "PAYLOAD_TOO_LARGE"
    assert call("GET", f"/v1/notes/{note['id']}")[1]["edited"] is False


# ---- 2. stuck notes -------------------------------------------------------------------------


class FlakyRepo(MemoryRepository):
    def __init__(self, fail_statuses: tuple[str, ...]) -> None:
        super().__init__()
        self.fail_statuses = fail_statuses

    def save_if_generation(self, clinic_id: str, note: Note, expected: str | None) -> bool:
        if note.status in self.fail_statuses:
            raise RuntimeError("ddb down")
        return super().save_if_generation(clinic_id, note, expected)


def test_final_save_failure_marks_failed() -> None:
    repo = FlakyRepo(("completed",))
    c, _ = make(repo)
    note = new_note(c)
    c.note_service.process(note.id, C, note.generation_id or "")  # does not raise
    failed = repo.get_note(C, note.id)
    assert failed and failed.status == "failed" and failed.error
    assert failed.error.code == "INTERNAL" and failed.result is None


def test_failure_save_failure_is_reraised() -> None:
    repo = FlakyRepo(("completed", "failed"))
    c, _ = make(repo)
    note = new_note(c)
    with pytest.raises(RuntimeError):
        c.note_service.process(note.id, C, note.generation_id or "")
    assert repo.get_note(C, note.id).status == "processing"  # type: ignore[union-attr]


def test_generator_crash_marks_internal(any_repo: Any) -> None:
    def boom() -> None:
        raise RuntimeError("secret transcript text")

    c, _ = make(any_repo, HookGenerator(boom))
    note = new_note(c)
    c.note_service.process(note.id, C, note.generation_id or "")
    failed = any_repo.get_note(C, note.id)
    assert failed.status == "failed" and failed.error.code == "INTERNAL"
    assert "secret" not in failed.error.message


def test_worker_handler_passes_deadline(container: Container) -> None:
    from vetscribe.handlers import worker

    gen = HookGenerator()
    c, _ = make(MemoryRepository(), gen)
    set_container(c)
    note = new_note(c)
    res = worker.lambda_handler(
        {"note_id": note.id, "generation_id": note.generation_id},
        Ctx(),  # type: ignore[arg-type]
    )
    assert res["ok"] is True
    assert gen.deadlines[0] is not None
    import time

    assert 800 < gen.deadlines[0] - time.monotonic() < 900  # 900 s budget minus the 30 s reserve
    # a payload without a generation id never runs generation
    n2 = new_note(c)
    worker.lambda_handler({"note_id": n2.id}, Ctx())  # type: ignore[arg-type]
    assert c.repository.get_note(C, n2.id).status == "pending"  # type: ignore[union-attr]


# ---- DLQ handler ----------------------------------------------------------------------------


def _dlq_event(*bodies: Any) -> dict[str, Any]:
    return {
        "Records": [
            {"messageId": f"m{i}", "body": b if isinstance(b, str) else json.dumps(b)}
            for i, b in enumerate(bodies)
        ]
    }


def test_dlq_handler_wrapped_and_raw_payloads(any_repo: Any) -> None:
    c, _ = make(any_repo)
    set_container(c)
    a, b, stale = new_note(c), new_note(c), new_note(c)
    done = new_note(c)
    c.note_service.process(done.id, C, done.generation_id or "")

    def payload(n: Note, gen: str | None = None) -> dict[str, Any]:
        return {"note_id": n.id, "clinic_id": C, "generation_id": gen or n.generation_id}

    wrapped = {
        "version": "1.0",
        "requestContext": {"condition": "RetriesExhausted"},
        "requestPayload": payload(a),
        "responseContext": {"statusCode": 200},
    }
    res = dlq.lambda_handler(
        _dlq_event(
            wrapped,
            payload(b),  # raw
            {"requestPayload": json.dumps(payload(stale, "old-gen"))},  # stale generation
            payload(done),  # already completed: must not be overwritten
            "not json",
            {"unrelated": 1},
            {"requestPayload": {"clinic_id": C}},  # no note id
        ),
        Ctx(),  # type: ignore[arg-type]
    )
    assert res == {"batchItemFailures": []}
    for n in (a, b):
        got = any_repo.get_note(C, n.id)
        assert got.status == "failed" and got.error.code == "GENERATION_TIMEOUT"
        assert got.error.message == "Generation did not finish. Try regenerating."
    assert any_repo.get_note(C, stale.id).status == "pending"
    assert any_repo.get_note(C, done.id).status == "completed"


def test_dlq_handler_reports_transient_failures() -> None:
    repo = FlakyRepo(("failed",))
    c, _ = make(repo)
    set_container(c)
    n = new_note(c)
    res = dlq.lambda_handler(
        _dlq_event({"note_id": n.id, "clinic_id": C, "generation_id": n.generation_id}),
        Ctx(),  # type: ignore[arg-type]
    )
    assert res == {"batchItemFailures": [{"itemIdentifier": "m0"}]}


# ---- read-path safety net -------------------------------------------------------------------


def test_stale_note_reported_as_timeout_on_get_and_persisted(any_repo: Any) -> None:
    c, _ = make(any_repo, stale_generation_seconds=1200)
    fresh, old = new_note(c), new_note(c)
    age(any_repo, old.id, 1300)
    age(any_repo, fresh.id, 1100)
    assert c.note_service.get(C, fresh.id).status == "pending"
    got = c.note_service.get(C, old.id)
    assert got.status == "failed" and got.error and got.error.code == "GENERATION_TIMEOUT"
    assert any_repo.get_note(C, old.id).status == "failed"  # persisted
    # ... so regenerate works again
    assert c.note_service.regenerate(C, old.id).status == "pending"


def test_stale_note_in_list(any_repo: Any) -> None:
    c, _ = make(any_repo)
    keep, old, gone = new_note(c), new_note(c), new_note(c)
    age(any_repo, old.id, 5000)
    items = {s.id: s for s in c.note_service.list(C)}
    assert items[old.id].status == "failed" and items[keep.id].status == "pending"
    assert any_repo.get_note(C, old.id).error.code == "GENERATION_TIMEOUT"
    # a note that vanishes between the summary query and the full read is dropped
    age(any_repo, gone.id, 5000)
    real = any_repo.get_note
    any_repo.get_note = lambda clinic, nid: None if nid == gone.id else real(clinic, nid)
    assert gone.id not in {s.id for s in c.note_service.list(C)}


def test_stale_expiry_loses_race_returns_stored_note(any_repo: Any) -> None:
    c, _ = make(any_repo)
    note = new_note(c)
    age(any_repo, note.id, 5000)
    real = any_repo.save_if_generation

    def finish_first(clinic: str, n: Note, expected: str | None) -> bool:
        other = any_repo.get_note(clinic, n.id)
        other.status, other.generation_id = "completed", "other"
        any_repo.put_note(clinic, other)
        return real(clinic, n, expected)  # type: ignore[no-any-return]

    any_repo.save_if_generation = finish_first
    assert c.note_service.get(C, note.id).status == "completed"


def test_stale_note_api_shape(container: Container) -> None:
    container._dispatcher = SyncDispatcher()  # type: ignore[assignment]
    container._note_service = None
    _, note, _ = call("POST", "/v1/notes", {"template_id": "builtin-soap", "transcript": "hello x"})
    age(container.repository, note["id"], 99_999)
    status, body, _ = call("GET", f"/v1/notes/{note['id']}")
    assert status == 200 and body["status"] == "failed"
    assert body["error"]["code"] == "GENERATION_TIMEOUT"


# ---- 5. PATCH validated against the snapshot -----------------------------------------------


def _completed_note(container: Container) -> dict[str, Any]:
    _, note, _ = call(
        "POST", "/v1/notes", {"template_id": "builtin-soap", "transcript": "She scratches a lot."}
    )
    container.dispatcher.join()  # type: ignore[attr-defined]
    done = call("GET", f"/v1/notes/{note['id']}")[1]
    assert done["status"] == "completed"
    return done  # type: ignore[no-any-return]


def test_patch_mismatched_sections_is_400(container: Container) -> None:
    done = _completed_note(container)
    url = f"/v1/notes/{done['id']}"

    def patched(mutate: Callable[[dict[str, Any]], None]) -> tuple[int, Any]:
        result = json.loads(json.dumps(done["result"]))
        mutate(result)
        status, body, _ = call("PATCH", url, {"result": result})
        return status, body

    assert patched(lambda r: None)[0] == 200
    cases: list[Callable[[dict[str, Any]], None]] = [
        lambda r: r["sections"].pop(),  # missing section
        lambda r: r["sections"].reverse(),  # wrong order
        lambda r: r["sections"].__setitem__(0, {**r["sections"][0], "section_id": "other"}),
        lambda r: r["sections"][0].update(format="bullets"),  # wrong format
        lambda r: r["sections"][1]["fields"].pop(),  # key_value keys differ
        lambda r: r["sections"][1]["fields"][0].update(key="nope"),
    ]
    for mutate in cases:
        status, body = patched(mutate)
        assert status == 400 and body["error"]["code"] == "VALIDATION_ERROR"
        assert body["error"]["details"] and "message" in body["error"]["details"][0]
    # Reordering the key_value fields is fine, only the key set matters.
    assert patched(lambda r: r["sections"][1]["fields"].reverse())[0] == 200


def test_patch_size_limits_are_400(container: Container) -> None:
    done = _completed_note(container)
    url = f"/v1/notes/{done['id']}"
    for mutate in (
        lambda r: r.update(visit_summary="x" * 501),
        lambda r: r["sections"][0].update(content="x" * 20_001),
        lambda r: r.update(action_items=["a"] * 51),
        lambda r: r.update(review_flags=["a" * 501]),
        lambda r: r["sections"][0].update(items=["i"] * 101),
    ):
        result = json.loads(json.dumps(done["result"]))
        mutate(result)
        assert call("PATCH", url, {"result": result})[0] == 400


# ---- request validation limits --------------------------------------------------------------


def test_request_validation_limits(container: Container) -> None:
    sec = {"id": "a", "title": "A"}
    ok = {"name": "N", "sections": [sec]}
    assert call("POST", "/v1/templates", ok)[0] == 201
    stripped = call("POST", "/v1/templates", {"name": "  Padded  ", "sections": [sec]})[1]
    assert stripped["name"] == "Padded"
    bad: list[dict[str, Any]] = [
        {"name": "   ", "sections": [sec]},
        {"name": "N", "sections": [{"id": "a", "title": "  \t "}]},
        {
            "name": "N",
            "sections": [
                {
                    "id": "a",
                    "title": "A",
                    "format": "key_value",
                    "fields": [{"key": "k", "label": "   "}],
                }
            ],
        },
        {"name": "N" * 121, "sections": [sec]},
        {"name": "N", "species": ["x"] * 11, "sections": [sec]},
        {
            "name": "N",
            "sections": [
                {
                    "id": "a",
                    "title": "A",
                    "format": "key_value",
                    "fields": [{"key": f"k{i}", "label": "L"} for i in range(31)],
                }
            ],
        },
        {
            "name": "N",
            "sections": [
                {
                    "id": "a",
                    "title": "A",
                    "format": "key_value",
                    "fields": [{"key": "k", "label": "L" * 81}],
                }
            ],
        },
        {
            "name": "N",
            "sections": [
                {
                    "id": "a",
                    "title": "A",
                    "format": "key_value",
                    "fields": [{"key": "k", "label": "L", "hint": "h" * 201}],
                }
            ],
        },
    ]
    for body in bad:
        status, resp, _ = call("POST", "/v1/templates", body)
        assert status == 400 and resp["error"]["code"] == "VALIDATION_ERROR", body
    base = {"template_id": "builtin-soap", "transcript": "hello there"}
    for extra in (
        {"patient": {"name": "n" * 121}},
        {"patient": {"species": "n" * 121}},
        {"clinician": "c" * 121},
        {"transcript": "é" * 150_001},  # 300 002 bytes, under MAX chars
    ):
        assert call("POST", "/v1/notes", {**base, **extra})[0] == 400, extra
    assert call("POST", "/v1/notes", {**base, "transcript": "é" * 150_000})[0] == 202


def test_new_error_codes_in_model() -> None:
    err = NoteError(code="GENERATION_TIMEOUT", message="m")
    assert NoteError(code="PAYLOAD_TOO_LARGE", message="m").code != err.code


def test_inline_dispatcher_passes_generation_id(container: Container) -> None:
    note = container.note_service.create(
        C, CreateNoteRequest(template_id="builtin-soap", transcript="She scratches her ears a lot.")
    )
    disp = container.dispatcher
    assert isinstance(disp, InlineThreadDispatcher)
    disp.join()
    assert container.note_service.get(C, note.id).status == "completed"
