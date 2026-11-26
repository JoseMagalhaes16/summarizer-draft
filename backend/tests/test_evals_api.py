from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from vetscribe.config import Settings
from vetscribe.container import Container, set_container
from vetscribe.evals.service import InlineEvalDispatcher

from .test_api import call

METRICS = {
    "schema_valid", "field_accuracy", "fact_recall", "hallucination_free",
    "missing_data_handling", "flag_recall", "action_recall", "faithfulness_proxy",
}  # fmt: skip
SUMMARY_KEYS = {
    "run_id", "status", "config", "created_at", "finished_at", "progress", "case_count",
    "metrics", "by_tag", "errors_count", "refusal_rate", "truncated_count", "input_tokens",
    "output_tokens", "latency_ms", "total_cost", "noise_floor",
}  # fmt: skip
ROW_KEYS = {
    "case_id", "case_title", "tags", "rep", "status", "stop_reason", "failure_class",
    "attempts", "scores", "details", "result", "model_info",
}  # fmt: skip
DETAIL_KEYS = {
    "missed_facts", "forbidden_found", "field_mismatches", "not_discussed_errors",
    "missing_flags", "missing_actions",
}  # fmt: skip


def make_container(tmp_path: Path, **settings: Any) -> Container:
    s = Settings(mock_latency_seconds=0.0, eval_results_dir=str(tmp_path), **settings)
    c = Container(s)
    set_container(c)
    return c


@pytest.fixture
def evals(tmp_path: Path) -> Iterator[Container]:
    c = make_container(tmp_path)
    yield c
    disp = c.eval_service.dispatcher
    assert isinstance(disp, InlineEvalDispatcher)
    disp.join()
    set_container(None)


def run_and_wait(c: Container, body: dict[str, Any]) -> dict[str, Any]:
    status, data, _ = call("POST", "/v1/evals/runs", body)
    assert status == 202, data
    disp = c.eval_service.dispatcher
    assert isinstance(disp, InlineEvalDispatcher)
    disp.join()
    status, done, _ = call("GET", f"/v1/evals/runs/{data['run_id']}")
    assert status == 200
    return done  # type: ignore[no-any-return]


def test_health_reports_trigger_flag(evals: Container) -> None:
    status, data, _ = call("GET", "/v1/health")
    assert status == 200 and data["evals_allow_trigger"] is True


def test_cases_endpoints(evals: Container) -> None:
    status, data, _ = call("GET", "/v1/evals/cases")
    assert status == 200 and len(data["items"]) >= 10
    item = next(i for i in data["items"] if i["id"] == "canine-otitis-01")
    assert set(item) == {
        "id", "title", "tags", "template_id", "verified_by_vet", "expectation_counts"
    }  # fmt: skip
    assert item["verified_by_vet"] is False
    assert set(item["expectation_counts"]) == {
        "fields", "facts", "forbidden", "not_discussed", "defaults_expected",
        "review_flags", "action_items",
    }  # fmt: skip
    status, detail, _ = call("GET", "/v1/evals/cases/canine-otitis-01")
    assert status == 200
    assert set(detail) == {
        "id", "title", "tags", "template_id", "patient", "transcript",
        "ground_truth", "expectations",
    }  # fmt: skip
    assert "Bella" in detail["transcript"] and detail["expectations"]["facts"]
    assert call("GET", "/v1/evals/cases/missing")[0] == 404


def test_run_lifecycle_and_response_shapes(evals: Container) -> None:
    status, data, _ = call(
        "POST",
        "/v1/evals/runs",
        {"label": "x", "provider": "oracle", "reps": 1, "tags": ["sparse"]},
    )
    assert status == 202
    assert set(data) >= SUMMARY_KEYS and data["status"] == "running"
    assert data["run_id"] and data["progress"]["total"] == 1
    evals.eval_service.dispatcher.join()  # type: ignore[attr-defined]

    status, run, _ = call("GET", f"/v1/evals/runs/{data['run_id']}")
    assert status == 200 and set(run) >= SUMMARY_KEYS and run["status"] == "completed"
    assert set(run["metrics"]) <= METRICS and run["metrics"]["fact_recall"].keys() == {
        "mean", "ci_low", "ci_high", "n"
    }  # fmt: skip
    assert set(run["input_tokens"]) == {"p50", "p95"}
    assert run["finished_at"] and "sparse" in run["by_tag"]

    status, listing, _ = call("GET", "/v1/evals/runs")
    assert status == 200 and [r["run_id"] for r in listing["items"]] == [data["run_id"]]
    assert set(listing["items"][0]) >= SUMMARY_KEYS

    status, res, _ = call("GET", f"/v1/evals/runs/{data['run_id']}/results")
    assert status == 200
    row = res["items"][0]
    assert set(row) >= ROW_KEYS and "raw" not in row
    assert set(row["details"]) >= DETAIL_KEYS
    assert row["status"] == "ok" and row["result"]["sections"]
    status, res, _ = call(
        "GET", f"/v1/evals/runs/{data['run_id']}/results", query={"include": "raw"}
    )
    assert "raw" in res["items"][0]
    assert call("GET", "/v1/evals/runs/nope")[0] == 404
    assert call("GET", "/v1/evals/runs/nope/results")[0] == 404


def test_compare_endpoint(evals: Container) -> None:
    null = run_and_wait(evals, {"provider": "null", "reps": 2, "tags": ["dental"]})
    oracle = run_and_wait(evals, {"provider": "oracle", "reps": 2, "tags": ["dental"]})
    status, cmp, _ = call(
        "GET", "/v1/evals/compare", query={"base": null["run_id"], "candidate": oracle["run_id"]}
    )
    assert status == 200
    assert set(cmp) == {"base", "candidate", "shared_cases", "metrics", "flipped"}
    assert set(cmp["base"]) >= SUMMARY_KEYS and cmp["shared_cases"] == 3
    m = cmp["metrics"]["fact_recall"]
    assert set(m) == {"base_mean", "candidate_mean", "delta", "ci_low", "ci_high", "n", "verdict"}
    assert m["verdict"] == "better" and m["delta"] > 0.9
    assert cmp["flipped"] and set(cmp["flipped"][0]) == {
        "case_id", "case_title", "rep", "metric", "base", "candidate", "direction"
    }  # fmt: skip
    # errors
    assert call("GET", "/v1/evals/compare", query={"base": "x"})[0] == 400
    assert (
        call("GET", "/v1/evals/compare", query={"base": "x", "candidate": oracle["run_id"]})[0]
        == 404
    )
    # a running run cannot be compared
    store = evals.eval_service.store
    running = json.loads(json.dumps(oracle))
    running.update(run_id="01RUNNING", status="running")
    from vetscribe.evals.models import RunSummary

    store.create_run(RunSummary.model_validate(running))
    status, err, _ = call(
        "GET", "/v1/evals/compare", query={"base": "01RUNNING", "candidate": oracle["run_id"]}
    )
    assert status == 409 and err["error"]["code"] == "RUN_NOT_COMPLETED"


def test_infra_error_rows_are_listed_but_not_scored(evals: Container) -> None:
    from vetscribe.evals.models import RunSummary

    store = evals.eval_service.store
    store.create_run(
        RunSummary(run_id="01ERR", config={}, created_at="2026-01-01T00:00:00Z", status="completed")  # type: ignore[arg-type]
    )
    store.append_error(
        "01ERR",
        {"case_id": "c", "rep": 1, "status": "error", "failure_class": "timeout", "message": "m"},
    )
    status, res, _ = call("GET", "/v1/evals/runs/01ERR/results")
    assert status == 200 and res["items"][0]["status"] == "error"


def test_post_validation(evals: Container) -> None:
    assert call("POST", "/v1/evals/runs", {"provider": "nope"})[0] == 400
    assert call("POST", "/v1/evals/runs", "{bad json")[0] == 400
    status, err, _ = call("POST", "/v1/evals/runs", {"provider": "oracle", "case_ids": ["zzz"]})
    assert status == 400 and "unknown case ids" in err["error"]["message"]
    status, err, _ = call("POST", "/v1/evals/runs", {"provider": "mock", "judge": True})
    assert status == 400


def test_trigger_disabled_is_403(tmp_path: Path) -> None:
    make_container(tmp_path, evals_allow_trigger=False)
    try:
        status, err, _ = call("POST", "/v1/evals/runs", {"provider": "oracle"})
        assert status == 403 and err["error"]["code"] == "EVALS_TRIGGER_DISABLED"
        assert call("GET", "/v1/health")[1]["evals_allow_trigger"] is False
        assert call("GET", "/v1/evals/runs")[0] == 200  # reading stays available
    finally:
        set_container(None)


def test_bedrock_provider_needs_bedrock_environment(evals: Container) -> None:
    status, err, _ = call("POST", "/v1/evals/runs", {"provider": "bedrock"})
    assert status == 400 and err["error"]["code"] == "BEDROCK_UNAVAILABLE"
    assert "LLM_PROVIDER=bedrock" in err["error"]["message"]


def test_settings_default_trigger_by_environment() -> None:
    assert Settings.from_env({"APP_ENV": "local"}).evals_allow_trigger is True
    assert Settings.from_env({"APP_ENV": "aws"}).evals_allow_trigger is False
    assert Settings.from_env({"APP_ENV": "aws", "EVALS_ALLOW_TRIGGER": "true"}).evals_allow_trigger
    assert not Settings.from_env({"EVALS_ALLOW_TRIGGER": "0"}).evals_allow_trigger
    with pytest.raises(ValueError):
        Settings.from_env({"EVALS_ALLOW_TRIGGER": "maybe"})
    s = Settings.from_env({"EVAL_STORE": "s3", "EVAL_S3_BUCKET": "b", "EVAL_S3_PREFIX": "x/"})
    assert (s.eval_store, s.eval_s3_bucket, s.eval_s3_prefix) == ("s3", "b", "x/")


def test_cases_fall_back_to_store_snapshots(tmp_path: Path) -> None:
    from vetscribe.evals.service import EvalService
    from vetscribe.evals.store import FileEvalStore

    store = FileEvalStore(tmp_path)
    from vetscribe.evals.cases import load_cases

    store.save_cases(load_cases()[:2])
    svc = EvalService(Settings(), store, cases_dir=tmp_path / "empty")
    assert len(svc.list_cases()) == 2
