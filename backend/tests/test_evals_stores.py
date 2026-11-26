from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import boto3
import pytest
from moto import mock_aws

from vetscribe.config import Settings
from vetscribe.evals.cases import BACKEND_DIR, load_cases
from vetscribe.evals.models import Progress, RunConfig, RunSummary
from vetscribe.evals.store import (
    DEFAULT_RESULTS_DIR,
    FileEvalStore,
    S3EvalStore,
    make_store,
    resolve_results_dir,
)


def summary(run_id: str, created: str = "2026-01-01T00:00:00Z") -> RunSummary:
    return RunSummary(
        run_id=run_id,
        config=RunConfig(label=run_id),
        created_at=created,
        progress=Progress(done=0, total=2),
    )


@pytest.fixture(params=["file", "s3"])
def store(request: pytest.FixtureRequest, tmp_path: Path) -> Iterator[Any]:
    if request.param == "file":
        yield FileEvalStore(tmp_path)
        return
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket="eval-bucket")
        yield S3EvalStore("eval-bucket", "evals", client)


def test_store_contract(store: Any) -> None:
    assert store.list_summaries() == [] and store.get_summary("nope") is None
    store.create_run(summary("01A"))
    store.create_run(summary("01B", "2026-02-01T00:00:00Z"))
    store.append_result("01A", {"case_id": "c", "rep": 1, "status": "ok", "scores": {}})
    store.append_error("01A", {"case_id": "c", "rep": 2, "status": "error"})
    store.update_progress("01A", 2, 2)
    store.flush("01A")
    assert store.get_summary("01A")["progress"] == {"done": 2, "total": 2}
    assert [r["case_id"] for r in store.read_results("01A")] == ["c"]
    assert store.read_errors("01A")[0]["rep"] == 2
    assert store.read_results("01B") == []
    assert [s["run_id"] for s in store.list_summaries()] == ["01B", "01A"]
    done = summary("01A").model_copy(update={"status": "completed"})
    store.write_summary(done)
    assert store.get_summary("01A")["status"] == "completed"
    assert store.get_summary("../etc") is None


def test_store_case_snapshots(store: Any) -> None:
    cases = load_cases()[:2]
    store.save_cases(cases)
    loaded = store.load_cases()
    assert sorted(c.id for c in loaded) == sorted(c.id for c in cases)
    assert loaded[0].transcript


def test_file_store_layout_and_invalid_ids(tmp_path: Path) -> None:
    st = FileEvalStore(tmp_path)
    st.create_run(summary("01A"))
    for name in ("config.json", "results.jsonl", "errors.jsonl", "summary.json"):
        assert (tmp_path / "runs" / "01A" / name).is_file()
    with pytest.raises(ValueError):
        st.append_result("../x", {})
    assert FileEvalStore(tmp_path / "missing").list_summaries() == []
    assert FileEvalStore(tmp_path / "missing").load_cases() == []


def test_s3_store_buffers_and_autoflushes() -> None:
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket="eval-bucket")
        st = S3EvalStore("eval-bucket", "p", client)
        st.create_run(summary("01A"))
        for i in range(S3EvalStore.FLUSH_EVERY):
            st.append_result("01A", {"case_id": "c", "rep": i})
        assert len(st.read_results("01A")) == S3EvalStore.FLUSH_EVERY  # auto flushed
        st.append_result("01A", {"case_id": "c", "rep": 99})
        assert len(st.read_results("01A")) == S3EvalStore.FLUSH_EVERY  # still buffered
        st.flush("01A")
        assert len(st.read_results("01A")) == S3EvalStore.FLUSH_EVERY + 1
        keys = [o["Key"] for o in client.list_objects_v2(Bucket="eval-bucket")["Contents"]]
        assert "p/runs/01A/summary.json" in keys
        with pytest.raises(ValueError):
            S3EvalStore("")
        st.update_progress("missing", 1, 1)  # no-op


def test_resolve_results_dir_is_relative_to_backend() -> None:
    assert resolve_results_dir("") == DEFAULT_RESULTS_DIR == BACKEND_DIR / ".eval-runs"
    assert resolve_results_dir("out/x") == (BACKEND_DIR / "out" / "x").resolve()
    assert resolve_results_dir("/abs/dir") == Path("/abs/dir")


def test_make_store_from_settings(tmp_path: Path) -> None:
    assert isinstance(make_store(Settings(eval_results_dir=str(tmp_path))), FileEvalStore)
    with mock_aws():
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket="eval-bucket")
        s3 = make_store(Settings(eval_store="s3", eval_s3_bucket="eval-bucket"))
        assert isinstance(s3, S3EvalStore)
        assert make_store(Settings(), "file") is not None
