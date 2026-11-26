"""Application service behind the ``/v1/evals/*`` routes."""

from __future__ import annotations

import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

from vetscribe.config import Settings
from vetscribe.errors import AppError, ai_disabled, not_found, validation_error
from vetscribe.evals.cases import DEFAULT_CASES_DIR, load_cases
from vetscribe.evals.compare import compare_runs
from vetscribe.evals.models import EvalCase, RunConfig
from vetscribe.evals.runner import EvalRunner, RunConfigError
from vetscribe.evals.store import EvalStore
from vetscribe.observability import logger


class EvalDispatcher(Protocol):
    def dispatch(self, fn: Callable[[], object]) -> None: ...


class InlineEvalDispatcher:
    """Run an eval in a daemon thread (local development and tests)."""

    def __init__(self) -> None:
        self.threads: list[threading.Thread] = []

    def dispatch(self, fn: Callable[[], object]) -> None:
        def guarded() -> None:
            try:
                fn()
            except Exception as exc:
                logger.error("eval_dispatch_failed", extra={"error": type(exc).__name__})

        t = threading.Thread(target=guarded, name="eval-run", daemon=True)
        self.threads = [x for x in self.threads if x.is_alive()]
        self.threads.append(t)
        t.start()

    def join(self, timeout: float = 30.0) -> None:
        for t in list(self.threads):
            t.join(timeout)


class EvalService:
    def __init__(
        self,
        settings: Settings,
        store: EvalStore,
        dispatcher: EvalDispatcher | None = None,
        runner_factory: Callable[[], EvalRunner] | None = None,
        cases_dir: Path | None = None,
    ) -> None:
        self.settings = settings
        self.store = store
        self.dispatcher: EvalDispatcher = dispatcher or InlineEvalDispatcher()
        self._runner_factory = runner_factory or (lambda: EvalRunner(store, settings))
        self._cases_dir = cases_dir or (
            Path(settings.eval_cases_dir) if settings.eval_cases_dir else DEFAULT_CASES_DIR
        )

    # -- cases -------------------------------------------------------------------------

    def cases(self) -> list[EvalCase]:
        local = load_cases(self._cases_dir)
        return local or self.store.load_cases()

    def list_cases(self) -> list[dict[str, Any]]:
        return [c.summary() for c in self.cases()]

    def get_case(self, case_id: str) -> dict[str, Any]:
        for c in self.cases():
            if c.id == case_id:
                return c.detail()
        raise not_found("Eval case")

    # -- runs --------------------------------------------------------------------------

    def list_runs(self, limit: int = 100) -> list[dict[str, Any]]:
        return self.store.list_summaries(limit)

    def get_run(self, run_id: str) -> dict[str, Any]:
        summary = self.store.get_summary(run_id)
        if summary is None:
            raise not_found("Eval run")
        return summary

    def results(self, run_id: str, include_raw: bool = False) -> list[dict[str, Any]]:
        self.get_run(run_id)
        rows = self.store.read_results(run_id) + self.store.read_errors(run_id)
        rows.sort(key=lambda r: (r["case_id"], r["rep"]))
        if include_raw:
            return rows
        return [{k: v for k, v in r.items() if k != "raw"} for r in rows]

    def compare(self, base_id: str, candidate_id: str) -> dict[str, Any]:
        base, cand = self.get_run(base_id), self.get_run(candidate_id)
        for s in (base, cand):
            if s["status"] != "completed":
                raise AppError(409, "RUN_NOT_COMPLETED", f"Run {s['run_id']} is not completed")
        diff = compare_runs(
            self.store.read_results(base_id),
            self.store.read_results(candidate_id),
            int(base["config"].get("seed", 0)),
        )
        return {"base": base, "candidate": cand, **diff}

    def start_run(self, config: RunConfig) -> dict[str, Any]:
        s = self.settings
        if not s.evals_allow_trigger:
            raise AppError(
                403,
                "EVALS_TRIGGER_DISABLED",
                "Starting eval runs from the API is disabled here. Run "
                "`python -m vetscribe.evals.cli run` (or the eval GitHub workflow) instead.",
            )
        if s.llm_provider == "none" and config.provider in ("mock", "bedrock"):
            raise ai_disabled()
        if config.provider == "bedrock" and s.llm_provider != "bedrock":
            raise AppError(
                400,
                "BEDROCK_UNAVAILABLE",
                "Provider 'bedrock' needs LLM_PROVIDER=bedrock in this environment; "
                "use mock, oracle or null here, or run the CLI with AWS credentials.",
            )
        runner = self._runner_factory()
        try:
            plan = runner.plan(config, self.cases())
        except RunConfigError as exc:
            raise validation_error(str(exc)) from exc
        self.dispatcher.dispatch(lambda: runner.execute(plan))
        return self.get_run(plan.run_id)
