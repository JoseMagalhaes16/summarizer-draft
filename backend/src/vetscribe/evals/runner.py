"""Run orchestration: production generator + production post-processing, graded per (case, rep).

Infra failures (Bedrock errors, throttling, timeouts) are written to ``errors.jsonl`` and never
become scores. Model outcomes are graded: refusals and truncations are recorded with their own
status and excluded from metrics; invalid output scores ``schema_valid = 0`` only.
"""

from __future__ import annotations

import json
import threading
import time
from collections import defaultdict
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any

from ulid import ULID

from vetscribe.config import Settings
from vetscribe.domain.builtin_templates import get_builtin
from vetscribe.domain.models import Template, utc_now_iso
from vetscribe.domain.postprocess import postprocess
from vetscribe.errors import GenerationError
from vetscribe.evals.generators import NullGenerator, OracleGenerator
from vetscribe.evals.graders import grade_all
from vetscribe.evals.judge import BedrockJudge, JudgeError
from vetscribe.evals.models import (
    CaseResult,
    EvalCase,
    MetricStat,
    Percentiles,
    Progress,
    RunConfig,
    RunSummary,
)
from vetscribe.evals.stats import metric_stat, percentile
from vetscribe.evals.store import EvalStore
from vetscribe.llm.base import GenerationResult, NoteGenerator
from vetscribe.observability import logger

GeneratorFactory = Callable[[RunConfig, EvalCase], NoteGenerator]
PriceTable = dict[str, dict[str, float]]


class RunConfigError(ValueError):
    """The run configuration cannot be executed (unknown case id, no cases, bad judge combo)."""


def parse_price_table(raw: str) -> PriceTable:
    """``{"model_id": {"input": $/MTok, "output": $/MTok}}`` from ``EVAL_PRICE_TABLE_JSON``."""
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
        return {
            str(k): {"input": float(v["input"]), "output": float(v["output"])}
            for k, v in data.items()
        }
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        raise RunConfigError(f"EVAL_PRICE_TABLE_JSON is invalid: {exc}") from exc


def compute_cost(
    table: PriceTable, model_id: str | None, tokens_in: int, tokens_out: int
) -> float | None:
    price = table.get(model_id or "")
    if price is None:
        return None
    return tokens_in * price["input"] / 1e6 + tokens_out * price["output"] / 1e6


def classify_failure(exc: GenerationError) -> str:
    msg = exc.message.lower()
    if exc.code == "GENERATION_TIMEOUT" or "timeout" in msg or "timed out" in msg:
        return "timeout"
    if "throttl" in msg:
        return "throttling"
    if "network" in msg:
        return "network"
    return "llm_error" if exc.code == "LLM_ERROR" else "internal"


def _call_with_timeout[T](fn: Callable[[], T], timeout: float) -> T:
    """Run ``fn`` in a daemon thread; raise ``TimeoutError`` if it exceeds ``timeout`` seconds."""
    box: dict[str, Any] = {}

    def target() -> None:
        try:
            box["value"] = fn()
        except BaseException as exc:
            box["error"] = exc

    t = threading.Thread(target=target, daemon=True, name="eval-call")
    t.start()
    t.join(timeout)
    if t.is_alive():
        raise TimeoutError(f"case exceeded the {timeout:g}s wall-clock ceiling")
    if "error" in box:
        raise box["error"]
    return box["value"]  # type: ignore[no-any-return]


@dataclass
class RunPlan:
    run_id: str
    config: RunConfig
    cases: list[EvalCase]
    created_at: str

    @property
    def total(self) -> int:
        return len(self.cases) * self.config.reps


def select_cases(config: RunConfig, cases: list[EvalCase]) -> list[EvalCase]:
    selected = cases
    if config.case_ids:
        known = {c.id for c in cases}
        unknown = [i for i in config.case_ids if i not in known]
        if unknown:
            raise RunConfigError(f"unknown case ids: {', '.join(unknown)}")
        selected = [c for c in selected if c.id in set(config.case_ids)]
    if config.tags:
        wanted = set(config.tags)
        selected = [c for c in selected if wanted & set(c.tags)]
    if not selected:
        raise RunConfigError("no cases match the selection")
    return selected


class EvalRunner:
    def __init__(
        self,
        store: EvalStore,
        settings: Settings,
        *,
        generator_factory: GeneratorFactory | None = None,
        bedrock_client: Any | None = None,
        judge_client: Any | None = None,
        price_table: PriceTable | None = None,
    ) -> None:
        self._store = store
        self._settings = settings
        self._factory = generator_factory
        self._bedrock_client = bedrock_client
        self._judge_client = judge_client
        self._prices = (
            price_table
            if price_table is not None
            else parse_price_table(settings.eval_price_table_json)
        )

    # -- planning ----------------------------------------------------------------------

    def plan(self, config: RunConfig, cases: list[EvalCase], run_id: str | None = None) -> RunPlan:
        if config.judge and config.provider != "bedrock":
            raise RunConfigError("the LLM judge requires provider 'bedrock'")
        selected = select_cases(config, cases)
        for case in selected:
            if get_builtin(case.template_id) is None:
                raise RunConfigError(f"case {case.id}: unknown template {case.template_id!r}")
        plan = RunPlan(run_id or str(ULID()), config, selected, utc_now_iso())
        self._store.create_run(
            RunSummary(
                run_id=plan.run_id,
                status="running",
                config=config,
                created_at=plan.created_at,
                progress=Progress(done=0, total=plan.total),
                case_count=len(selected),
            )
        )
        self._store.save_cases(selected)
        return plan

    # -- generators --------------------------------------------------------------------

    def _make_factory(self, config: RunConfig) -> GeneratorFactory:
        if self._factory is not None:
            return self._factory
        if config.provider == "oracle":
            return lambda _cfg, case: OracleGenerator(case)
        if config.provider == "null":
            null = NullGenerator()
            return lambda _cfg, _case: null
        if config.provider == "mock":
            from vetscribe.llm.mock import MockNoteGenerator

            mock = MockNoteGenerator(0.0)
            return lambda _cfg, _case: mock

        from vetscribe.llm.bedrock import BedrockNoteGenerator

        overrides: dict[str, Any] = {}
        if config.model_id:
            overrides["bedrock_model_id"] = config.model_id
        if config.structured_mode:
            overrides["bedrock_structured_mode"] = config.structured_mode
        if config.effort:
            overrides["bedrock_effort"] = config.effort
        bedrock = BedrockNoteGenerator(
            self._settings.with_overrides(**overrides), client=self._bedrock_client
        )
        return lambda _cfg, _case: bedrock

    def _make_judge(self, config: RunConfig) -> BedrockJudge | None:
        if not (config.judge and config.provider == "bedrock"):
            return None
        client = self._judge_client
        if client is None:
            from vetscribe.llm.bedrock import make_client

            client = make_client(self._settings)
        model = config.judge_model_id or config.model_id or self._settings.bedrock_model_id
        return BedrockJudge(client, model)

    # -- one (case, rep) ---------------------------------------------------------------

    def _base_row(self, plan: RunPlan, case: EvalCase, rep: int) -> dict[str, Any]:
        return {
            "run_id": plan.run_id,
            "case_id": case.id,
            "case_title": case.title,
            "tags": case.tags,
            "rep": rep,
        }

    def _run_one(
        self,
        plan: RunPlan,
        case: EvalCase,
        rep: int,
        gen: NoteGenerator,
        judge: BedrockJudge | None,
    ) -> tuple[bool, dict[str, Any]]:
        """Return ``(is_error, row)``."""
        template = get_builtin(case.template_id)
        assert template is not None
        base = self._base_row(plan, case, rep)
        timeout = plan.config.case_timeout_s
        deadline = time.monotonic() + timeout
        try:
            gres: GenerationResult = _call_with_timeout(
                lambda: gen.generate(template, case.transcript, case.patient, "", deadline), timeout
            )
        except GenerationError as exc:
            return self._from_generation_error(base, exc)
        except TimeoutError as exc:
            return True, {
                **base,
                "status": "error",
                "failure_class": "timeout",
                "message": str(exc),
            }
        except Exception as exc:
            logger.warning("eval_unexpected_error", extra={"error": type(exc).__name__})
            return True, {
                **base,
                "status": "error",
                "failure_class": "internal",
                "message": f"{type(exc).__name__}: {exc}",
            }
        return False, self._grade(base, case, template, gres, judge)

    def _from_generation_error(
        self, base: dict[str, Any], exc: GenerationError
    ) -> tuple[bool, dict[str, Any]]:
        if exc.code == "MODEL_REFUSAL":
            return False, {
                **base,
                "status": "refused",
                "stop_reason": "refusal",
                "message": exc.message,
            }
        if exc.code == "OUTPUT_TRUNCATED":
            return False, {
                **base,
                "status": "truncated",
                "stop_reason": "max_tokens",
                "message": exc.message,
            }
        if exc.code == "INVALID_MODEL_OUTPUT":
            return False, {
                **base,
                "status": "invalid",
                "scores": {"schema_valid": 0.0},
                "message": exc.message,
            }
        return True, {
            **base,
            "status": "error",
            "failure_class": classify_failure(exc),
            "message": exc.message,
        }

    def _grade(
        self,
        base: dict[str, Any],
        case: EvalCase,
        template: Template,
        gres: GenerationResult,
        judge: BedrockJudge | None,
    ) -> dict[str, Any]:
        info = gres.model_info
        row: dict[str, Any] = {
            **base,
            "stop_reason": gres.stop_reason,
            "attempts": gres.attempts,
            "model_id": info.model_id,
            "input_tokens": info.input_tokens,
            "output_tokens": info.output_tokens,
            "latency_ms": info.latency_ms,
            "cost_usd": compute_cost(
                self._prices, info.model_id, info.input_tokens, info.output_tokens
            ),
            "model_info": info.model_dump(mode="json"),
            "raw": gres.raw,
        }
        try:
            note = postprocess(gres.raw, template)
        except GenerationError as exc:
            return {
                **row,
                "status": "invalid",
                "scores": {"schema_valid": 0.0},
                "message": exc.message,
            }
        scores, details = grade_all(case, template, note, gres.raw)
        row.update(status="ok", result=note.model_dump(mode="json"))
        if judge is not None:
            try:
                judged, rationale = judge.judge(template, case.transcript, note)
                scores.update(judged)
                row["judge"] = rationale
            except JudgeError as exc:
                row["judge"] = {"error": str(exc)}
        row.update(scores=scores, details=details)
        return row

    # -- execution ---------------------------------------------------------------------

    def execute(self, plan: RunPlan) -> RunSummary:
        store, cfg = self._store, plan.config
        rows: list[dict[str, Any]] = []
        errors: list[dict[str, Any]] = []
        try:
            factory = self._make_factory(cfg)
            judge = self._make_judge(cfg)
            done = 0
            with ThreadPoolExecutor(max_workers=cfg.concurrency, thread_name_prefix="eval") as pool:
                futures = [
                    pool.submit(self._run_one, plan, case, rep, factory(cfg, case), judge)
                    for case in plan.cases
                    for rep in range(1, cfg.reps + 1)
                ]
                for fut in as_completed(futures):
                    is_error, row = fut.result()
                    if is_error:
                        row["at"] = utc_now_iso()
                        errors.append(row)
                        store.append_error(plan.run_id, row)
                    else:
                        rows.append(row)
                        store.append_result(
                            plan.run_id, CaseResult.model_validate(row).model_dump(mode="json")
                        )
                    done += 1
                    store.update_progress(plan.run_id, done, plan.total)
            store.flush(plan.run_id)
            summary = summarize(plan, rows, errors, status="completed")
        except Exception as exc:
            logger.error("eval_run_failed", extra={"error": type(exc).__name__})
            store.flush(plan.run_id)
            summary = summarize(
                plan, rows, errors, status="failed", error=f"{type(exc).__name__}: {exc}"
            )
        store.write_summary(summary)
        return summary

    def run(self, config: RunConfig, cases: list[EvalCase]) -> RunSummary:
        return self.execute(self.plan(config, cases))


# ----------------------------------------------------------------------------- summaries


def _metric_stats(rows: list[dict[str, Any]], seed: int) -> dict[str, MetricStat]:
    per_metric: dict[str, list[float | None]] = defaultdict(list)
    for r in rows:
        for k, v in (r.get("scores") or {}).items():
            per_metric[k].append(v)
    out = {}
    for name, vals in per_metric.items():
        stat = metric_stat(name, vals, seed)
        if stat is not None:
            out[name] = stat
    return out


def summarize(
    plan: RunPlan,
    rows: list[dict[str, Any]],
    errors: list[dict[str, Any]],
    *,
    status: str,
    error: str | None = None,
) -> RunSummary:
    from vetscribe.evals.models import METRIC_KEYS

    seed = plan.config.seed
    stats = _metric_stats(rows, seed)
    ordered = {k: stats[k] for k in METRIC_KEYS if k in stats}
    by_tag: dict[str, dict[str, MetricStat]] = {}
    tags = sorted({t for r in rows for t in r.get("tags", [])})
    for tag in tags:
        sub = _metric_stats([r for r in rows if tag in r.get("tags", [])], seed)
        by_tag[tag] = {k: sub[k] for k in METRIC_KEYS if k in sub}

    graded = [r for r in rows if r["status"] in ("ok", "invalid")]
    served = [r for r in rows if r.get("model_id")]
    costs = [r["cost_usd"] for r in served]

    def pct(key: str) -> Percentiles:
        vals = [float(r[key]) for r in served if r.get(key) is not None]
        return Percentiles(p50=percentile(vals, 50), p95=percentile(vals, 95))

    fact = ordered.get("fact_recall")
    return RunSummary(
        run_id=plan.run_id,
        status=status,
        config=plan.config,
        created_at=plan.created_at,
        finished_at=utc_now_iso(),
        progress=Progress(done=len(rows) + len(errors), total=plan.total),
        case_count=len(plan.cases),
        metrics=ordered,
        by_tag=by_tag,
        errors_count=len(errors),
        refusal_rate=(sum(r["status"] == "refused" for r in rows) / len(rows)) if rows else 0.0,
        truncated_count=sum(r["status"] == "truncated" for r in rows),
        input_tokens=pct("input_tokens"),
        output_tokens=pct("output_tokens"),
        latency_ms=pct("latency_ms"),
        total_cost=sum(costs) if costs and all(c is not None for c in costs) else None,
        noise_floor=(fact.ci_high - fact.ci_low) / 2 if fact else None,
        hallucination_failures=sorted(
            {
                r["case_id"]
                for r in graded
                if (r.get("scores") or {}).get("hallucination_free") == 0.0
            }
        ),
        served_model_ids=sorted({r["model_id"] for r in served}),
        error=error,
    )
