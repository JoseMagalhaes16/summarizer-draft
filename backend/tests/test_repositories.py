from __future__ import annotations

import boto3
import pytest
from moto import mock_aws

from vetscribe.domain.models import Note, Template
from vetscribe.repositories.dynamodb import DynamoRepository
from vetscribe.repositories.memory import MemoryRepository

CLINIC = "c1"


def _tpl(tid: str = "t1") -> Template:
    return Template.model_validate(
        {"id": tid, "name": "N", "sections": [{"id": "a", "title": "A"}]}
    )


def _note(nid: str, soap: Template) -> Note:
    return Note(
        id=nid, template_id=soap.id, template_name=soap.name, template_snapshot=soap, transcript="x"
    )


@pytest.fixture(params=["memory", "dynamodb"])
def repo(request: pytest.FixtureRequest):  # type: ignore[no-untyped-def]
    if request.param == "memory":
        yield MemoryRepository()
        return
    with mock_aws():
        ddb = boto3.resource("dynamodb", region_name="us-east-1")
        ddb.create_table(
            TableName="t",
            KeySchema=[
                {"AttributeName": "PK", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "PK", "AttributeType": "S"},
                {"AttributeName": "SK", "AttributeType": "S"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        yield DynamoRepository(ddb.Table("t"))


def test_template_crud(repo) -> None:  # type: ignore[no-untyped-def]
    assert repo.get_template(CLINIC, "t1") is None
    repo.put_template(CLINIC, _tpl("t1"))
    repo.put_template(CLINIC, _tpl("t2"))
    repo.put_template("other", _tpl("t3"))
    assert repo.get_template(CLINIC, "t1").name == "N"
    assert {t.id for t in repo.list_templates(CLINIC)} == {"t1", "t2"}
    assert repo.delete_template(CLINIC, "t1") is True
    assert repo.delete_template(CLINIC, "t1") is False


def test_note_crud_and_order(repo, soap: Template) -> None:  # type: ignore[no-untyped-def]
    for i in ("01", "03", "02"):
        repo.put_note(CLINIC, _note(i, soap))
    repo.put_template(CLINIC, _tpl())  # must not leak into note list
    assert [n.id for n in repo.list_note_summaries(CLINIC)] == ["03", "02", "01"]
    assert [n.id for n in repo.list_note_summaries(CLINIC, limit=2)] == ["03", "02"]
    n = repo.get_note(CLINIC, "02")
    n.status = "completed"
    repo.put_note(CLINIC, n)
    assert repo.get_note(CLINIC, "02").status == "completed"
    assert repo.get_note("other", "02") is None
    assert repo.delete_note(CLINIC, "02") and not repo.delete_note(CLINIC, "02")


def test_memory_file_persistence(tmp_path, soap: Template) -> None:  # type: ignore[no-untyped-def]
    path = tmp_path / "sub" / "data.json"
    r1 = MemoryRepository(str(path))
    r1.put_note(CLINIC, _note("n1", soap))
    r1.put_template(CLINIC, _tpl())
    r2 = MemoryRepository(str(path))
    assert r2.get_note(CLINIC, "n1") is not None and r2.get_template(CLINIC, "t1") is not None
    r2.delete_note(CLINIC, "n1")
    assert MemoryRepository(str(path)).get_note(CLINIC, "n1") is None


def test_memory_corrupt_file_ignored(tmp_path) -> None:  # type: ignore[no-untyped-def]
    p = tmp_path / "d.json"
    p.write_text("{not json")
    assert MemoryRepository(str(p)).list_note_summaries(CLINIC) == []
