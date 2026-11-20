"""Paired comparison of two completed runs (paired by case and rep)."""

from __future__ import annotations

from typing import Any

from vetscribe.evals.models import METRIC_KEYS
from vetscribe.evals.stats import mean, paired_diff

PASS_THRESHOLD = 1.0
MAX_FLIPPED = 300


def compare_runs(
    base_rows: list[dict[str, Any]],
    cand_rows: list[dict[str, Any]],
    seed: int = 0,
) -> dict[str, Any]:
    """Return ``{shared_cases, metrics, flipped}`` for the compare endpoint."""

    def index(rows: list[dict[str, Any]]) -> dict[tuple[str, int], dict[str, Any]]:
        return {(r["case_id"], r["rep"]): r for r in rows if r.get("status") != "error"}

    b, c = index(base_rows), index(cand_rows)
    keys = sorted(set(b) & set(c))
    metrics: dict[str, Any] = {}
    flipped: list[dict[str, Any]] = []
    for metric in METRIC_KEYS:
        pairs = []
        for k in keys:
            bs, cs = b[k]["scores"].get(metric), c[k]["scores"].get(metric)
            if bs is not None and cs is not None:
                pairs.append((k, float(bs), float(cs)))
        if not pairs:
            continue
        bvals, cvals = [p[1] for p in pairs], [p[2] for p in pairs]
        delta, lo, hi, verdict = paired_diff(bvals, cvals, seed, metric)
        metrics[metric] = {
            "base_mean": mean(bvals),
            "candidate_mean": mean(cvals),
            "delta": delta,
            "ci_low": lo,
            "ci_high": hi,
            "n": len(pairs),
            "verdict": verdict,
        }
        for (case_id, rep), bs, cs in pairs:
            was, now = bs >= PASS_THRESHOLD, cs >= PASS_THRESHOLD
            if was != now:
                flipped.append(
                    {
                        "case_id": case_id,
                        "case_title": b[(case_id, rep)].get("case_title", ""),
                        "rep": rep,
                        "metric": metric,
                        "base": bs,
                        "candidate": cs,
                        "direction": "better" if now else "worse",
                    }
                )
    return {
        "shared_cases": len({k[0] for k in keys}),
        "metrics": metrics,
        "flipped": flipped[:MAX_FLIPPED],
    }
