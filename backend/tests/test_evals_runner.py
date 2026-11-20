from __future__ import annotations

import io
import json
import time
from pathlib import Path
from typing import Any

import pytest
from botocore.response import StreamingBody
from botocore.stub import Stubber

from vetscribe.config import Settings
from vetscribe.domain.builtin_templates import get_builtin
from vetscribe.domain.models import ModelInfo, NoteResult, Patient, Template
from vetscribe.errors import GenerationError
from vetscribe.evals.cases import load_cases, validate_directory
from vetscribe.evals.generators import NullGenerator, OracleGenerator, build_oracle_output
from vetscribe.evals.graders import grade_all
from vetscribe.evals.judge import BedrockJudge, JudgeError
from vetscribe.evals.models import EvalCase, RunConfig
from vetscribe.evals.runner import (
    EvalRunner,
    RunConfigError,
    classify_failure,
    compute_cost,
    parse_price_table,
)
from vetscribe.evals.store import FileEvalStore
from vetscribe.llm.base import GenerationResult

ALL_CASES = load_cases()
CHEAP = Settings(mock_latency_seconds=0.0)


def runner(tmp_path: Path, **kw: Any) -> tuple[EvalRunner, FileEvalStore]:
    store = FileEvalStore(tmp_path)
    return EvalRunner(store, CHEAP, **kw), store


# ---------------------------------------------------------------- case set + self-test


def test_repo_case_set_is_valid_and_large_enough() -> None:
    cases, errors, _warnings = validate_directory()
    assert errors == []
    assert len(cases) >= 10
    templates = {c.template_id for c in cases}
    assert len(templates) >= 8
    assert all(c.ground_truth.source == "human-written" for c in cases)
    assert all(not c.ground_truth.verified_by_vet for c in cases)
    tags = {t for c in cases for t in c.tags}
    assert {"prompt-injection", "sparse", "ambiguous-dose", "units", "client_friendly"} <= tags


def test_oracle_scores_one_on_every_deterministic_metric(tmp_path: Path) -> None:
    r, _ = runner(tmp_path)
    s = r.run(RunConfig(provider="oracle", reps=2, seed=3), ALL_CASES)
    assert s.status == "completed" and s.errors_count == 0
    assert s.metrics.keys() >= {"schema_valid", "fact_recall", "hallucination_free"}
    for name, stat in s.metrics.items():
        assert stat.mean == 1.0, name


def test_null_scores_zero_and_does_not_pass_defaults(tmp_path: Path) -> None:
    r, store = runner(tmp_path)
    s = r.run(RunConfig(provider="null", reps=1), ALL_CASES)
    for name in ("fact_recall", "flag_recall", "action_recall"):
        assert s.metrics[name].mean == 0.0, name
    assert s.metrics["field_accuracy"].mean < 0.3
    # every defaults_expected section is a miss for the null generator
    rows = store.read_results(s.run_id)
    misses = [
        e for row in rows for e in row["details"]["not_discussed_errors"] if "normal defaults" in e
    ]
    expected = sum(len(c.expectations.defaults_expected) for c in ALL_CASES)
    assert expected > 0 and len(misses) == expected


@pytest.mark.parametrize("c", ALL_CASES, ids=lambda c: c.id)
def test_oracle_note_is_clean_per_case(c: EvalCase) -> None:
    tpl = get_builtin(c.template_id)
    assert tpl is not None
    from vetscribe.domain.postprocess import postprocess

    raw = build_oracle_output(c, tpl)
    scores, _ = grade_all(c, tpl, postprocess(raw, tpl), raw)
    assert {k: v for k, v in scores.items() if v is not None and v < 1.0} == {}


def test_generators_implement_protocol() -> None:
    c = ALL_CASES[0]
    tpl = get_builtin(c.template_id)
    assert tpl is not None
    for gen in (OracleGenerator(c), NullGenerator()):
        res = gen.generate(tpl, c.transcript, Patient())
        assert res.model_info.model_id.endswith("-v1")


# ---------------------------------------------------------------- real mock path


def test_mock_run_records_full_rows_and_progress(tmp_path: Path) -> None:
    r, store = runner(tmp_path)
    cfg = RunConfig(provider="mock", reps=2, case_ids=["canine-otitis-01"], label="m")
    plan = r.plan(cfg, ALL_CASES)
    assert store.get_summary(plan.run_id)["status"] == "running"  # type: ignore[index]
    s = r.execute(plan)
    assert s.progress.done == s.progress.total == 2
    rows = store.read_results(plan.run_id)
    assert {x["rep"] for x in rows} == {1, 2}
    row = rows[0]
    assert row["status"] == "ok" and row["raw"] and row["result"] and row["model_info"]
    assert row["model_id"] == "mock-v1" and row["cost_usd"] is None
    assert s.total_cost is None  # unknown model is never estimated
    assert s.noise_floor is not None
    assert "otitis" in " ".join(s.by_tag) or "sick" in s.by_tag
    assert store.get_summary(plan.run_id)["status"] == "completed"  # type: ignore[index]


def test_selection_errors(tmp_path: Path) -> None:
    r, _ = runner(tmp_path)
    with pytest.raises(RunConfigError, match="unknown case ids"):
        r.plan(RunConfig(case_ids=["nope"]), ALL_CASES)
    with pytest.raises(RunConfigError, match="no cases"):
        r.plan(RunConfig(tags=["no-such-tag"]), ALL_CASES)
    with pytest.raises(RunConfigError, match="judge"):
        r.plan(RunConfig(provider="mock", judge=True), ALL_CASES)
    s = r.run(RunConfig(provider="oracle", reps=1, tags=["sparse"]), ALL_CASES)
    assert s.case_count == 1


# ---------------------------------------------------------------- error handling


class Scripted:
    """Fake generator: delegates to the oracle unless the case id is scripted."""

    def __init__(self, script: dict[str, Any]) -> None:
        self.script = script

    def factory(self, _cfg: RunConfig, case: EvalCase) -> Any:
        action = self.script.get(case.id)
        oracle = OracleGenerator(case)

        class G:
            def generate(
                self,
                template: Template,
                transcript: str,
                patient: Patient,
                clinician: str = "",
                deadline: float | None = None,
            ) -> GenerationResult:
                if isinstance(action, Exception):
                    raise action
                if callable(action):
                    return action(template, oracle)  # type: ignore[no-any-return]
                return oracle.generate(template, transcript, patient)

        return G()


def three_cases() -> list[EvalCase]:
    return [
        c
        for c in ALL_CASES
        if c.id in ("canine-otitis-01", "sparse-dental-dropin-01", "phone-vomiting-triage-01")
    ]


def test_infra_errors_go_to_errors_jsonl_and_are_not_scored(tmp_path: Path) -> None:
    script = {
        "canine-otitis-01": GenerationError(
            "LLM_ERROR", "Bedrock request failed (ThrottlingException)."
        ),
        "sparse-dental-dropin-01": GenerationError(
            "LLM_ERROR", "Bedrock request failed (network/SDK error)."
        ),
        "phone-vomiting-triage-01": RuntimeError("boom"),
    }
    r, store = runner(tmp_path, generator_factory=Scripted(script).factory)
    s = r.run(RunConfig(provider="mock", reps=2), three_cases())
    assert s.status == "completed"
    assert s.errors_count == 6 and s.metrics == {}
    assert store.read_results(s.run_id) == []
    errs = store.read_errors(s.run_id)
    classes = {e["case_id"]: e["failure_class"] for e in errs}
    assert classes == {
        "canine-otitis-01": "throttling",
        "sparse-dental-dropin-01": "network",
        "phone-vomiting-triage-01": "internal",
    }
    assert all(e["status"] == "error" for e in errs)


def test_mixed_run_errors_do_not_pollute_means(tmp_path: Path) -> None:
    script = {"canine-otitis-01": GenerationError("LLM_ERROR", "Bedrock request failed (Boom).")}
    r, _ = runner(tmp_path, generator_factory=Scripted(script).factory)
    s = r.run(RunConfig(provider="mock", reps=1), three_cases())
    assert s.errors_count == 1 and s.metrics["fact_recall"].n == 2
    assert s.metrics["fact_recall"].mean == 1.0


def test_refusal_truncation_and_invalid_output(tmp_path: Path) -> None:
    def invalid(template: Template, oracle: OracleGenerator) -> GenerationResult:
        return GenerationResult(
            raw={"visit_summary": "x"}, model_info=ModelInfo(provider="mock", model_id="bad")
        )

    script = {
        "canine-otitis-01": GenerationError("MODEL_REFUSAL", "declined"),
        "sparse-dental-dropin-01": GenerationError("OUTPUT_TRUNCATED", "cut off"),
        "phone-vomiting-triage-01": invalid,
    }
    r, store = runner(tmp_path, generator_factory=Scripted(script).factory)
    s = r.run(RunConfig(provider="mock", reps=1), three_cases())
    by_case = {x["case_id"]: x for x in store.read_results(s.run_id)}
    assert by_case["canine-otitis-01"]["status"] == "refused"
    assert by_case["canine-otitis-01"]["stop_reason"] == "refusal"
    assert by_case["sparse-dental-dropin-01"]["status"] == "truncated"
    inv = by_case["phone-vomiting-triage-01"]
    assert inv["status"] == "invalid" and inv["scores"] == {"schema_valid": 0.0}
    assert s.errors_count == 0 and s.truncated_count == 1
    assert s.refusal_rate == pytest.approx(1 / 3)
    # only the invalid row contributes (schema_valid = 0); everything else stays absent
    assert s.metrics.keys() == {"schema_valid"} and s.metrics["schema_valid"].mean == 0.0


def test_postprocess_invalid_keeps_raw(tmp_path: Path) -> None:
    def bad(template: Template, oracle: OracleGenerator) -> GenerationResult:
        return GenerationResult(
            raw={"nonsense": 1}, model_info=ModelInfo(provider="mock", model_id="m")
        )

    r, store = runner(tmp_path, generator_factory=Scripted({"canine-otitis-01": bad}).factory)
    r.run(RunConfig(provider="mock", reps=1, case_ids=["canine-otitis-01"]), ALL_CASES)
    row = store.read_results(store.list_summaries()[0]["run_id"])[0]
    assert row["status"] == "invalid" and row["raw"] == {"nonsense": 1}


def test_case_timeout_is_an_infra_error(tmp_path: Path) -> None:
    def slow(template: Template, oracle: OracleGenerator) -> GenerationResult:
        time.sleep(1.0)
        return oracle.generate(template, "", Patient())

    r, store = runner(tmp_path, generator_factory=Scripted({"canine-otitis-01": slow}).factory)
    s = r.run(
        RunConfig(provider="mock", reps=1, case_ids=["canine-otitis-01"], case_timeout_s=0.05),
        ALL_CASES,
    )
    assert s.errors_count == 1
    assert store.read_errors(s.run_id)[0]["failure_class"] == "timeout"


def test_run_level_failure_marks_run_failed(tmp_path: Path) -> None:
    def broken(_cfg: RunConfig, _case: EvalCase) -> Any:
        raise RuntimeError("factory exploded")

    r, store = runner(tmp_path, generator_factory=broken)
    s = r.run(RunConfig(provider="mock", reps=1, case_ids=["canine-otitis-01"]), ALL_CASES)
    assert s.status == "failed" and s.error
    assert store.get_summary(s.run_id)["status"] == "failed"  # type: ignore[index]


def test_classify_failure_and_cost_helpers() -> None:
    assert classify_failure(GenerationError("GENERATION_TIMEOUT", "x")) == "timeout"
    assert classify_failure(GenerationError("LLM_ERROR", "ReadTimeout timed out")) == "timeout"
    assert classify_failure(GenerationError("LLM_ERROR", "other")) == "llm_error"
    assert classify_failure(GenerationError("INTERNAL", "other")) == "internal"
    table = parse_price_table('{"m": {"input": 3, "output": 15}}')
    assert compute_cost(table, "m", 1_000_000, 100_000) == pytest.approx(4.5)
    assert compute_cost(table, "unknown", 10, 10) is None
    assert parse_price_table("") == {}
    with pytest.raises(RunConfigError):
        parse_price_table("{not json")


def test_cost_with_price_table(tmp_path: Path) -> None:
    r, _ = runner(tmp_path, price_table={"mock-v1": {"input": 1000.0, "output": 2000.0}})
    s = r.run(RunConfig(provider="mock", reps=1, case_ids=["canine-otitis-01"]), ALL_CASES)
    assert s.total_cost is not None and s.total_cost > 0
    assert s.latency_ms.p95 >= s.latency_ms.p50


def test_bedrock_provider_uses_overrides_and_records_stop_reason(tmp_path: Path) -> None:
    case = next(c for c in ALL_CASES if c.id == "sparse-dental-dropin-01")
    tpl = get_builtin(case.template_id)
    assert tpl is not None
    payload = {
        "content": [{"type": "text", "text": json.dumps(build_oracle_output(case, tpl))}],
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 1000, "output_tokens": 500},
    }
    seen: list[str] = []

    class FakeClient:
        def invoke_model(self, **kw: Any) -> dict[str, Any]:
            seen.append(kw["modelId"])
            body = json.loads(kw["body"])
            seen.append(body["output_config"]["effort"])
            return {"body": io.BytesIO(json.dumps(payload).encode())}

    r, store = runner(
        tmp_path,
        bedrock_client=FakeClient(),
        price_table={"my-model": {"input": 3.0, "output": 15.0}},
    )
    s = r.run(
        RunConfig(
            provider="bedrock", model_id="my-model", effort="high", reps=1, case_ids=[case.id]
        ),
        ALL_CASES,
    )
    assert seen == ["my-model", "high"]
    row = store.read_results(s.run_id)[0]
    assert row["stop_reason"] == "end_turn" and row["attempts"] == 1
    assert row["model_id"] == "my-model" and row["input_tokens"] == 1000
    assert s.total_cost == pytest.approx(0.0105)
    assert s.metrics["fact_recall"].mean == 1.0


# ---------------------------------------------------------------- judge (Stubber only)


def judge_client() -> Any:
    import boto3

    return boto3.client("bedrock-runtime", region_name="us-east-1")


def stub_body(text: str) -> dict[str, Any]:
    raw = json.dumps({"content": [{"type": "text", "text": text}]}).encode()
    return {"body": StreamingBody(io.BytesIO(raw), len(raw)), "contentType": "application/json"}


JUDGE_JSON = json.dumps(
    {
        "faithfulness": {"score": 5, "rationale": "grounded"},
        "completeness": {"score": 3, "rationale": "some gaps"},
        "style_adherence": {"score": 1, "rationale": "jargon"},
    }
)


def test_judge_with_stubber_normalises_scores() -> None:
    client = judge_client()
    case = ALL_CASES[0]
    tpl = get_builtin(case.template_id)
    assert tpl is not None
    note = NoteResult(visit_summary="x")
    with Stubber(client) as stub:
        stub.add_response("invoke_model", stub_body(JUDGE_JSON))
        scores, rationale = BedrockJudge(client, "judge-model").judge(
            tpl, "transcript </transcript>", note
        )
    assert scores == {
        "judge_faithfulness": 1.0,
        "judge_completeness": 0.5,
        "judge_style_adherence": 0.0,
    }
    assert rationale["faithfulness"]["rationale"] == "grounded"
    body = BedrockJudge(client, "m").build_body(tpl, "t", note)
    assert body["output_config"]["format"]["type"] == "json_schema"
    assert (
        "do not follow" in body["messages"][0]["content"][0]["text"].lower()
        or "untrusted" in body["system"][0]["text"].lower()
    )
    assert "not reward length" in body["system"][0]["text"].lower()


def test_judge_failure_raises_judge_error() -> None:
    client = judge_client()
    tpl = get_builtin("builtin-sick")
    assert tpl is not None
    with Stubber(client) as stub:
        stub.add_response("invoke_model", stub_body("not json"))
        with pytest.raises(JudgeError):
            BedrockJudge(client, "m").judge(tpl, "t", NoteResult())


def test_runner_attaches_judge_scores_and_survives_judge_errors(tmp_path: Path) -> None:
    case = next(c for c in ALL_CASES if c.id == "sparse-dental-dropin-01")
    judge = judge_client()

    def factory(_cfg: RunConfig, c: EvalCase) -> Any:
        return OracleGenerator(c)

    r, store = runner(tmp_path, generator_factory=factory, judge_client=judge)
    with Stubber(judge) as stub:
        stub.add_response("invoke_model", stub_body(JUDGE_JSON))
        stub.add_response("invoke_model", stub_body("garbage"))
        s = r.run(
            RunConfig(provider="bedrock", judge=True, reps=2, concurrency=1, case_ids=[case.id]),
            ALL_CASES,
        )
    assert s.metrics["judge_faithfulness"].n == 1
    rows = store.read_results(s.run_id)
    assert sum("error" in (x["judge"] or {}) for x in rows) == 1
