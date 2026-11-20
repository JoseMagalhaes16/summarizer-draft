"""``python -m vetscribe.evals.cli run|list|show|compare|validate-cases``."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from vetscribe.config import Settings
from vetscribe.errors import AppError
from vetscribe.evals.cases import load_cases, validate_directory
from vetscribe.evals.models import METRIC_KEYS, RunConfig
from vetscribe.evals.runner import EvalRunner, RunConfigError
from vetscribe.evals.service import EvalService
from vetscribe.evals.store import make_store


def _settings(args: argparse.Namespace) -> Settings:
    s = Settings.from_env()
    changes: dict[str, Any] = {}
    if getattr(args, "store", None):
        changes["eval_store"] = args.store
    if getattr(args, "results_dir", None):
        changes["eval_results_dir"] = args.results_dir
    if getattr(args, "cases_dir", None):
        changes["eval_cases_dir"] = args.cases_dir
    return s.with_overrides(**changes) if changes else s


def _fmt(v: float | None, digits: int = 3) -> str:
    return "-" if v is None else f"{v:.{digits}f}"


def render_table(rows: list[list[str]], header: list[str]) -> str:
    widths = [max(len(str(r[i])) for r in [header, *rows]) for i in range(len(header))]
    line = "  ".join("-" * w for w in widths)

    def fmt(r: list[str]) -> str:
        return "  ".join(str(c).ljust(w) for c, w in zip(r, widths, strict=True))

    return "\n".join([fmt(header), line, *(fmt(r) for r in rows)])


def render_summary(s: dict[str, Any], by_tag: bool = False) -> str:
    cfg = s["config"]
    model = cfg.get("model_id") or "default"
    out = [
        f"run {s['run_id']}  [{s['status']}]  {cfg.get('label') or '(no label)'}",
        f"provider={cfg['provider']} model={model} effort={cfg.get('effort') or 'default'} "
        f"reps={cfg['reps']} cases={s['case_count']} "
        f"progress={s['progress']['done']}/{s['progress']['total']}",
        f"errors={s['errors_count']} refusal_rate={_fmt(s['refusal_rate'])} "
        f"truncated={s['truncated_count']} noise_floor={_fmt(s.get('noise_floor'))} "
        f"cost={_fmt(s.get('total_cost'), 4)}",
        f"latency_ms p50/p95={s['latency_ms']['p50']:.0f}/{s['latency_ms']['p95']:.0f} "
        f"tokens in p50={s['input_tokens']['p50']:.0f} out p50={s['output_tokens']['p50']:.0f}",
        "",
    ]
    rows = [
        [k, _fmt(m["mean"]), f"[{m['ci_low']:.3f}, {m['ci_high']:.3f}]", str(m["n"])]
        for k in METRIC_KEYS
        if (m := s["metrics"].get(k))
    ]
    out.append(render_table(rows, ["metric", "mean", "95% CI", "n"]) if rows else "(no metrics)")
    if s.get("hallucination_failures"):
        out.append("\nhallucination_free FAILED on: " + ", ".join(s["hallucination_failures"]))
    if s.get("error"):
        out.append(f"\nrun error: {s['error']}")
    if by_tag and s.get("by_tag"):
        out.append("\nPer tag:")
        for tag, stats in s["by_tag"].items():
            cells = " ".join(f"{k}={m['mean']:.2f}" for k, m in stats.items())
            out.append(f"  {tag}: {cells}")
    return "\n".join(out)


def _parse_fail_under(items: list[str]) -> dict[str, float]:
    out = {}
    for item in items:
        name, sep, value = item.partition("=")
        if not sep or name not in METRIC_KEYS:
            raise SystemExit(f"--fail-under expects metric=value with metric in {METRIC_KEYS}")
        out[name] = float(value)
    return out


def cmd_run(args: argparse.Namespace) -> int:
    fail_under = _parse_fail_under(args.fail_under)
    settings = _settings(args)
    config = RunConfig(
        label=args.label,
        provider=args.provider,
        model_id=args.model_id,
        structured_mode=args.structured_mode,
        effort=args.effort,
        reps=args.reps,
        case_ids=args.case_id or None,
        tags=args.tag or None,
        judge=args.judge,
        judge_model_id=args.judge_model_id,
        seed=args.seed,
        concurrency=args.concurrency,
        case_timeout_s=args.timeout,
    )
    store = make_store(settings)
    cases_dir = Path(settings.eval_cases_dir) if settings.eval_cases_dir else None
    runner = EvalRunner(store, settings)
    try:
        summary = runner.run(config, load_cases(cases_dir))
    except RunConfigError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    data = summary.model_dump(mode="json")
    print(render_summary(data, by_tag=args.by_tag))
    if summary.status != "completed":
        return 1
    violations = []
    for metric, floor in fail_under.items():
        stat = data["metrics"].get(metric)
        if stat is None or stat["mean"] < floor:
            got = "missing" if stat is None else f"{stat['mean']:.3f}"
            violations.append(f"{metric}: {got} < {floor}")
    if violations:
        print("\nFAIL-UNDER violated:\n  " + "\n  ".join(violations), file=sys.stderr)
        return 1
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    store = make_store(_settings(args))
    rows = []
    for s in store.list_summaries():
        m = s["metrics"].get("fact_recall")
        rows.append(
            [
                s["run_id"],
                s["status"],
                s["config"].get("label") or "",
                s["config"]["provider"],
                f"{s['progress']['done']}/{s['progress']['total']}",
                _fmt(m["mean"]) if m else "-",
            ]
        )
    print(render_table(rows, ["run_id", "status", "label", "provider", "progress", "fact_recall"]))
    return 0


def cmd_show(args: argparse.Namespace) -> int:
    store = make_store(_settings(args))
    summary = store.get_summary(args.run_id)
    if summary is None:
        print(f"error: run {args.run_id} not found", file=sys.stderr)
        return 2
    print(json.dumps(summary, indent=2) if args.json else render_summary(summary, args.by_tag))
    return 0


def cmd_compare(args: argparse.Namespace) -> int:
    settings = _settings(args)
    svc = EvalService(settings, make_store(settings))
    try:
        data = svc.compare(args.base, args.candidate)
    except AppError as exc:
        print(f"error: {exc.message}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(data, indent=2))
        return 0
    rows = [
        [
            k,
            _fmt(m["base_mean"]),
            _fmt(m["candidate_mean"]),
            f"{m['delta']:+.3f}",
            f"[{m['ci_low']:+.3f}, {m['ci_high']:+.3f}]",
            str(m["n"]),
            m["verdict"],
        ]
        for k, m in data["metrics"].items()
    ]
    print(f"base={args.base}\ncandidate={args.candidate}  shared cases={data['shared_cases']}\n")
    print(render_table(rows, ["metric", "base", "candidate", "delta", "95% CI", "n", "verdict"]))
    if data["flipped"]:
        print(f"\n{len(data['flipped'])} case/metric pass-fail flips (see --json)")
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    cases, errors, warnings = validate_directory(args.dir)
    for w in warnings:
        print(f"warning: {w}")
    for e in errors:
        print(f"error: {e}", file=sys.stderr)
    if errors:
        print(f"{len(errors)} error(s) in {len(cases)} case(s)", file=sys.stderr)
        return 1
    print(f"ok: {len(cases)} cases valid ({len(warnings)} warnings)")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="vetscribe.evals.cli", description="VetScribe evaluations")
    sub = p.add_subparsers(dest="command", required=True)

    def common(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--store", choices=["file", "s3"], help="override EVAL_STORE")
        sp.add_argument("--results-dir", help="override EVAL_RESULTS_DIR (file store)")

    r = sub.add_parser("run", help="run an evaluation")
    common(r)
    r.add_argument("--label", default="")
    r.add_argument("--provider", choices=["mock", "bedrock", "oracle", "null"], default="mock")
    r.add_argument("--model-id")
    r.add_argument("--structured-mode", choices=["output_config", "tool"])
    r.add_argument("--effort", choices=["low", "medium", "high"])
    r.add_argument("--reps", type=int, default=2)
    r.add_argument("--case-id", action="append", help="repeatable")
    r.add_argument("--tag", action="append", help="repeatable (any-of)")
    r.add_argument("--judge", action="store_true", help="LLM judge (bedrock only)")
    r.add_argument("--judge-model-id")
    r.add_argument("--seed", type=int, default=0)
    r.add_argument("--concurrency", type=int, default=4)
    r.add_argument("--timeout", type=float, default=600.0, help="per-case wall-clock seconds")
    r.add_argument("--cases-dir", help="override EVAL_CASES_DIR")
    r.add_argument("--by-tag", action="store_true")
    r.add_argument(
        "--fail-under", action="append", default=[], metavar="METRIC=VALUE", help="repeatable"
    )
    r.set_defaults(func=cmd_run)

    ls = sub.add_parser("list", help="list runs")
    common(ls)
    ls.set_defaults(func=cmd_list)

    sh = sub.add_parser("show", help="show a run")
    common(sh)
    sh.add_argument("run_id")
    sh.add_argument("--json", action="store_true")
    sh.add_argument("--by-tag", action="store_true")
    sh.set_defaults(func=cmd_show)

    cp = sub.add_parser("compare", help="paired comparison of two completed runs")
    common(cp)
    cp.add_argument("base")
    cp.add_argument("candidate")
    cp.add_argument("--json", action="store_true")
    cp.set_defaults(func=cmd_compare)

    v = sub.add_parser("validate-cases", help="validate the case set")
    v.add_argument("--dir")
    v.set_defaults(func=cmd_validate)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
