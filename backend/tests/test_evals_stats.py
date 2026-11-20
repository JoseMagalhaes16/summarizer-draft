from __future__ import annotations

import pytest

from vetscribe.evals import stats
from vetscribe.evals.compare import compare_runs
from vetscribe.evals.models import RunConfig


def test_wilson_known_values() -> None:
    lo, hi = stats.wilson(8, 10)
    assert lo == pytest.approx(0.4902, abs=1e-3)
    assert hi == pytest.approx(0.9433, abs=1e-3)
    lo, hi = stats.wilson(0, 10)
    assert lo == 0.0 and hi == pytest.approx(0.2775, abs=1e-3)
    lo, hi = stats.wilson(10, 10)
    assert hi == pytest.approx(1.0) and lo == pytest.approx(0.7225, abs=1e-3)
    with pytest.raises(ValueError):
        stats.wilson(0, 0)


def test_bootstrap_is_seeded_and_brackets_mean() -> None:
    vals = [0.2, 0.4, 0.6, 0.8, 1.0, 0.5, 0.7, 0.3]
    a = stats.bootstrap_ci(vals, seed=1, name="m")
    assert a == stats.bootstrap_ci(vals, seed=1, name="m")
    assert a != stats.bootstrap_ci(vals, seed=2, name="m")
    assert a[0] < stats.mean(vals) < a[1]
    assert stats.bootstrap_ci([0.5, 0.5, 0.5], 0) == (0.5, 0.5)
    with pytest.raises(ValueError):
        stats.bootstrap_ci([])


def test_metric_stat_binary_vs_fractional_and_nulls() -> None:
    s = stats.metric_stat("hallucination_free", [1.0, 1.0, 0.0, None], seed=0)
    assert s is not None and s.n == 3
    assert (s.ci_low, s.ci_high) == pytest.approx(stats.wilson(2, 3))
    f = stats.metric_stat("fact_recall", [0.5, 1.0, None], seed=0)
    assert f is not None and f.n == 2 and f.mean == 0.75
    assert stats.metric_stat("fact_recall", [None], seed=0) is None


def test_percentile() -> None:
    assert stats.percentile([], 50) == 0.0
    assert stats.percentile([1, 2, 3, 4, 5], 50) == 3
    assert stats.percentile([1, 2, 3, 4, 5], 95) == pytest.approx(4.8)


def test_paired_diff_verdicts() -> None:
    base = [0.2, 0.3, 0.4, 0.2, 0.3, 0.25, 0.35, 0.3]
    better = [b + 0.3 for b in base]
    d, lo, _hi, v = stats.paired_diff(base, better, seed=0)
    assert d == pytest.approx(0.3) and lo > 0 and v == "better"
    assert stats.paired_diff(better, base, seed=0)[3] == "worse"
    assert stats.paired_diff(base, base, seed=0)[3] == "within_noise"
    noisy = [0.1, -0.1, 0.2, -0.2, 0.05, -0.05]
    cand = [0.5 + x for x in noisy]
    assert stats.paired_diff([0.5] * 6, cand, seed=0)[3] == "within_noise"
    with pytest.raises(ValueError):
        stats.paired_diff([1.0], [], seed=0)


def row(case_id: str, rep: int, **scores: float | None) -> dict[str, object]:
    return {"case_id": case_id, "case_title": case_id, "rep": rep, "status": "ok", "scores": scores}


def test_compare_runs_pairs_and_flips() -> None:
    base = [
        row(f"c{i}", r, fact_recall=0.4, hallucination_free=1.0) for i in range(6) for r in (1, 2)
    ]
    cand = [
        row(f"c{i}", r, fact_recall=0.9, hallucination_free=1.0) for i in range(6) for r in (1, 2)
    ]
    cand[0]["scores"] = {"fact_recall": 1.0, "hallucination_free": 0.0}
    base.append({"case_id": "only-base", "rep": 1, "status": "ok", "scores": {"fact_recall": 0.0}})
    base.append({"case_id": "c0", "rep": 9, "status": "error", "scores": {}})
    out = compare_runs(base, cand)  # type: ignore[arg-type]
    assert out["shared_cases"] == 6
    fr = out["metrics"]["fact_recall"]
    assert fr["verdict"] == "better" and fr["n"] == 12 and fr["delta"] > 0.4
    assert out["metrics"]["hallucination_free"]["verdict"] == "within_noise"
    flips = [f for f in out["flipped"] if f["metric"] == "hallucination_free"]
    assert flips == [
        {
            "case_id": "c0",
            "case_title": "c0",
            "rep": 1,
            "metric": "hallucination_free",
            "base": 1.0,
            "candidate": 0.0,
            "direction": "worse",
        }
    ]
    better = [f for f in out["flipped"] if f["metric"] == "fact_recall"]
    assert [(f["case_id"], f["rep"], f["direction"]) for f in better] == [("c0", 1, "better")]


def test_run_config_blank_model_becomes_none() -> None:
    assert RunConfig(model_id="  ").model_id is None
