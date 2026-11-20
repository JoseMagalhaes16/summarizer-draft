"""Statistics: Wilson interval, seeded bootstrap, percentiles and paired differences."""

from __future__ import annotations

import math
import random
import zlib
from collections.abc import Sequence

from vetscribe.evals.models import BINARY_METRICS, MetricStat

Z95 = 1.959963984540054
RESAMPLES = 1000


def mean(xs: Sequence[float]) -> float:
    return sum(xs) / len(xs)


def wilson(successes: float, n: int, z: float = Z95) -> tuple[float, float]:
    """Wilson score interval for a proportion."""
    if n <= 0:
        raise ValueError("n must be positive")
    p = successes / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def _seed_for(seed: int, name: str) -> int:
    return seed * 1_000_003 + zlib.crc32(name.encode())


def bootstrap_ci(
    values: Sequence[float], seed: int = 0, name: str = "", resamples: int = RESAMPLES
) -> tuple[float, float]:
    """Percentile bootstrap 95% CI of the mean (seeded, deterministic)."""
    if not values:
        raise ValueError("values must not be empty")
    rng = random.Random(_seed_for(seed, name))
    n = len(values)
    means = sorted(sum(rng.choices(values, k=n)) / n for _ in range(resamples))
    lo = means[int(0.025 * (resamples - 1))]
    hi = means[math.ceil(0.975 * (resamples - 1))]
    return lo, hi


def metric_stat(metric: str, values: Sequence[float | None], seed: int = 0) -> MetricStat | None:
    vals = [v for v in values if v is not None]
    if not vals:
        return None
    m = mean(vals)
    if metric in BINARY_METRICS:
        lo, hi = wilson(sum(vals), len(vals))
    else:
        lo, hi = bootstrap_ci(vals, seed, metric)
    return MetricStat(mean=m, ci_low=min(lo, m), ci_high=max(hi, m), n=len(vals))


def percentile(values: Sequence[float], q: float) -> float:
    """Linear-interpolated percentile (q in 0..100); 0.0 for no data."""
    if not values:
        return 0.0
    xs = sorted(values)
    k = (len(xs) - 1) * q / 100
    lo, hi = math.floor(k), math.ceil(k)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def paired_diff(
    base: Sequence[float], cand: Sequence[float], seed: int = 0, name: str = ""
) -> tuple[float, float, float, str]:
    """Return ``(delta, ci_low, ci_high, verdict)`` for paired scores (candidate - base)."""
    if len(base) != len(cand) or not base:
        raise ValueError("paired samples must be equal-length and non-empty")
    deltas = [c - b for b, c in zip(base, cand, strict=True)]
    d = mean(deltas)
    lo, hi = bootstrap_ci(deltas, seed, "paired:" + name)
    lo, hi = min(lo, d), max(hi, d)
    verdict = "better" if lo > 0 else "worse" if hi < 0 else "within_noise"
    return d, lo, hi, verdict
