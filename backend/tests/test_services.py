from __future__ import annotations

import time
from typing import Any

import pytest

from vetscribe.config import Settings
from vetscribe.container import Container
from vetscribe.domain.models import CreateNoteRequest, NoteResult, Patient, TemplateInput
from vetscribe.errors import AppError, GenerationError
from vetscribe.jobs.dispatcher import InlineThreadDispatcher, LambdaAsyncDispatcher
from vetscribe.llm.base import GenerationResult

C = "clinic"


def _input(name: str = "Mine") -> TemplateInput:
    return TemplateInput.model_validate({"name": name, "sections": [{"id": "a", "title": "A"}]})


class SyncDispatcher:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def dispatch(self, note_id: str, clinic_id: str) -> None:
        self.calls.append((note_id, clinic_id))


class BoomDispatcher:
    def dispatch(self, note_id: str, clinic_id: str) -> None:
        raise RuntimeError("nope")


class StaticGenerator:
    def __init__(self, exc: Exception | None = None, raw: dict[str, Any] | None = None) -> None:
        self.exc, self.raw = exc, raw

    def generate(
        self, template: Any, transcript: str, patient: Any, clinician: str = ""
    ) -> GenerationResult:
        if self.exc:
            raise self.exc
        assert self.raw is not None
        from vetscribe.domain.models import ModelInfo

        return GenerationResult(self.raw, ModelInfo(provider="mock", model_id="m"))


def test_template_lifecycle(container: Container) -> None:
    svc = container.template_service
    builtins = svc.list(C)
    assert all(t.is_builtin for t in builtins) and len(builtins) >= 7
    t = svc.create(C, _input())
    assert t.version == 1 and not t.is_builtin
    t2 = svc.update(C, t.id, _input("Renamed"))
    assert t2.version == 2 and t2.name == "Renamed" and t2.created_at == t.created_at
    ids = [x.id for x in svc.list(C)]
    assert ids[-1] == t.id
    dup = svc.duplicate(C, "builtin-soap")
    assert dup.name.endswith("(copy)") and not dup.is_builtin and dup.id != "builtin-soap"
    assert svc.duplicate(C, t.id, "X").name == "X"
    svc.delete(C, t.id)
    with pytest.raises(AppError) as ei:
        svc.get(C, t.id)
    assert ei.value.status == 404


def test_builtin_read_only(container: Container) -> None:
    svc = container.template_service
    for op in (
        lambda: svc.update(C, "builtin-soap", _input()),
        lambda: svc.delete(C, "builtin-soap"),
    ):
        with pytest.raises(AppError) as ei:
            op()
        assert ei.value.status == 403 and ei.value.code == "READ_ONLY"
    with pytest.raises(AppError):
        svc.update(C, "missing", _input())
    with pytest.raises(AppError):
        svc.delete(C, "missing")


def _service(settings: Settings, gen: Any, disp: Any) -> Container:
    return Container(settings, generator=gen, dispatcher=disp)


def test_create_validates(settings: Settings) -> None:
    c = _service(
        settings.with_overrides(max_transcript_chars=10), StaticGenerator(), SyncDispatcher()
    )
    with pytest.raises(AppError) as ei:
        c.note_service.create(C, CreateNoteRequest(template_id="builtin-soap", transcript="  \n"))
    assert ei.value.code == "VALIDATION_ERROR"
    with pytest.raises(AppError):
        c.note_service.create(C, CreateNoteRequest(template_id="builtin-soap", transcript="x" * 11))
    with pytest.raises(AppError) as ei2:
        c.note_service.create(C, CreateNoteRequest(template_id="nope", transcript="hello"))
    assert ei2.value.status == 404


def test_process_success_and_edit_flow(settings: Settings, otitis: str) -> None:
    disp = SyncDispatcher()
    c = Container(settings, dispatcher=disp)
    svc = c.note_service
    note = svc.create(
        C,
        CreateNoteRequest(
            template_id="builtin-soap", transcript=otitis, patient=Patient(name="Bella")
        ),
    )
    assert note.status == "pending" and disp.calls == [(note.id, C)]
    with pytest.raises(AppError) as ei:
        svc.update_result(C, note.id, NoteResult())
    assert ei.value.status == 409 and ei.value.code == "NOT_COMPLETED"
    svc.process(note.id, C)
    done = svc.get(C, note.id)
    assert done.status == "completed" and done.result and done.model_info
    svc.process(note.id, C)  # no-op when completed
    edited = svc.update_result(
        C, note.id, done.result.model_copy(update={"visit_summary": "Edited"})
    )
    assert edited.edited and svc.list(C)[0].visit_summary == "Edited"
    again = svc.regenerate(C, note.id, "builtin-wellness")
    assert again.status == "pending" and again.result is None and not again.edited
    assert again.template_id == "builtin-wellness" and len(disp.calls) == 2
    svc.delete(C, note.id)
    with pytest.raises(AppError):
        svc.get(C, note.id)
    with pytest.raises(AppError):
        svc.delete(C, note.id)
    svc.process("missing", C)  # logs, no error


@pytest.mark.parametrize(
    ("gen", "code"),
    [
        (StaticGenerator(exc=GenerationError("MODEL_REFUSAL", "no")), "MODEL_REFUSAL"),
        (StaticGenerator(exc=RuntimeError("secret transcript text")), "INTERNAL"),
        (StaticGenerator(raw={"bad": 1}), "INVALID_MODEL_OUTPUT"),
    ],
)
def test_process_failures(settings: Settings, gen: Any, code: str) -> None:
    c = _service(settings, gen, SyncDispatcher())
    note = c.note_service.create(
        C, CreateNoteRequest(template_id="builtin-soap", transcript="hello there")
    )
    c.note_service.process(note.id, C)
    failed = c.note_service.get(C, note.id)
    assert failed.status == "failed" and failed.error and failed.error.code == code
    assert "secret" not in failed.error.message
    assert failed.result is None


def test_dispatch_failure_marks_failed(settings: Settings) -> None:
    c = _service(settings, StaticGenerator(), BoomDispatcher())
    note = c.note_service.create(
        C, CreateNoteRequest(template_id="builtin-soap", transcript="hello there")
    )
    assert note.status == "failed" and note.error and note.error.code == "INTERNAL"


def test_regenerate_missing_template(settings: Settings) -> None:
    c = _service(settings, StaticGenerator(), SyncDispatcher())
    note = c.note_service.create(
        C, CreateNoteRequest(template_id="builtin-soap", transcript="hello there")
    )
    with pytest.raises(AppError):
        c.note_service.regenerate(C, note.id, "nope")


def test_deleted_while_processing(settings: Settings) -> None:
    c = Container(settings)
    note = c.note_service.create(
        C, CreateNoteRequest(template_id="builtin-soap", transcript="hello there")
    )
    c.dispatcher.join()  # type: ignore[attr-defined]
    c.note_service.delete(C, note.id)
    c.note_service.process(note.id, C)
    assert c.repository.get_note(C, note.id) is None


def test_inline_dispatcher_runs_in_thread_and_swallows_errors() -> None:
    seen: list[tuple[str, str]] = []

    def worker(n: str, c: str) -> None:
        seen.append((n, c))
        raise RuntimeError("x")

    d = InlineThreadDispatcher(worker)
    d.dispatch("n1", "c1")
    d.join()
    assert seen == [("n1", "c1")] and d.threads[0].daemon


def test_lambda_dispatcher() -> None:
    import json

    class FakeLambda:
        def invoke(self, **kw: Any) -> None:
            self.kw = kw

    fake = FakeLambda()
    LambdaAsyncDispatcher("fn", fake).dispatch("n1", "c1")
    assert fake.kw["InvocationType"] == "Event" and fake.kw["FunctionName"] == "fn"
    assert json.loads(fake.kw["Payload"]) == {"note_id": "n1", "clinic_id": "c1"}
    with pytest.raises(ValueError):
        LambdaAsyncDispatcher("", fake)


def test_container_wiring(tmp_path: Any) -> None:
    from vetscribe.llm.mock import MockNoteGenerator
    from vetscribe.repositories.memory import MemoryRepository

    c = Container(Settings(local_data_file=str(tmp_path / "d.json")))
    assert isinstance(c.repository, MemoryRepository) and isinstance(c.generator, MockNoteGenerator)
    assert isinstance(c.dispatcher, InlineThreadDispatcher)
    assert c.note_service is c.note_service
    with pytest.raises(ValueError):
        Container(Settings(storage_backend="dynamodb")).repository  # noqa: B018


def test_container_aws_wiring() -> None:
    import boto3
    from moto import mock_aws

    from vetscribe.llm.bedrock import BedrockNoteGenerator
    from vetscribe.repositories.dynamodb import DynamoRepository

    with mock_aws():
        boto3.resource("dynamodb", region_name="us-east-1").create_table(
            TableName="tbl",
            KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}],
            AttributeDefinitions=[{"AttributeName": "PK", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        c = Container(
            Settings(
                storage_backend="dynamodb",
                table_name="tbl",
                llm_provider="bedrock",
                job_dispatcher="lambda",
                worker_function_name="w",
            )
        )
        assert isinstance(c.repository, DynamoRepository)
        assert isinstance(c.generator, BedrockNoteGenerator)
        assert isinstance(c.dispatcher, LambdaAsyncDispatcher)


def test_get_container_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    from vetscribe.container import get_container, set_container

    set_container(None)
    monkeypatch.setenv("MOCK_LATENCY_SECONDS", "0")
    c = get_container()
    assert get_container() is c and c.settings.mock_latency_seconds == 0
    set_container(None)
    _ = time
