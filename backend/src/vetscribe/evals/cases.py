"""Load and validate the version-controlled case set (``backend/evals/cases/*.json``)."""

from __future__ import annotations

from pathlib import Path

from pydantic import ValidationError

from vetscribe.domain.builtin_templates import get_builtin
from vetscribe.domain.models import Template
from vetscribe.evals.graders import find_term, normalize_text
from vetscribe.evals.models import EvalCase

BACKEND_DIR = Path(__file__).resolve().parents[3]
DEFAULT_CASES_DIR = BACKEND_DIR / "evals" / "cases"
ALLOWED_SOURCES = frozenset({"human-written", "vet-written", "production-sampled-consented"})
MIN_WORDS, MAX_WORDS = 250, 600


class CaseError(Exception):
    """A case file could not be read or parsed."""


def load_case(path: Path) -> EvalCase:
    try:
        case = EvalCase.model_validate_json(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, ValidationError) as exc:
        raise CaseError(f"{path.name}: {exc}") from exc
    if case.transcript_file:
        tpath = (path.parent / case.transcript_file).resolve()
        try:
            text = tpath.read_text(encoding="utf-8")
        except OSError as exc:
            raise CaseError(f"{path.name}: cannot read transcript_file: {exc}") from exc
        case = case.model_copy(update={"transcript": text, "transcript_file": None})
    return case


def load_cases(directory: Path | str | None = None) -> list[EvalCase]:
    d = Path(directory) if directory else DEFAULT_CASES_DIR
    if not d.is_dir():
        return []
    return [load_case(p) for p in sorted(d.glob("*.json"))]


def _template(case: EvalCase) -> Template | None:
    return get_builtin(case.template_id)


def validate_case(case: EvalCase, *, filename: str | None = None) -> tuple[list[str], list[str]]:
    """Return ``(errors, warnings)`` for one case."""
    errors: list[str] = []
    warnings: list[str] = []
    if filename is not None and filename != f"{case.id}.json":
        errors.append(f"file name must be {case.id}.json")
    if case.ground_truth.source not in ALLOWED_SOURCES:
        errors.append(
            f"ground_truth.source {case.ground_truth.source!r} not in {sorted(ALLOWED_SOURCES)}"
            " (ground truth must never come from a model)"
        )
    words = len(case.transcript.split())
    if "sparse" not in case.tags and not MIN_WORDS <= words <= MAX_WORDS:
        warnings.append(f"transcript has {words} words (expected {MIN_WORDS}-{MAX_WORDS})")

    tpl = _template(case)
    if tpl is None:
        errors.append(f"unknown built-in template_id {case.template_id!r}")
        return errors, warnings
    sections = {s.id: s for s in tpl.sections}
    ex = case.expectations
    transcript = normalize_text(case.transcript)

    seen: set[str] = set()
    for group, items in (
        ("facts", ex.facts),
        ("forbidden", ex.forbidden),
        ("review_flags", ex.review_flags),
        ("action_items", ex.action_items),
    ):
        for item in items:
            key = f"{group}:{item.id}"
            if key in seen:
                errors.append(f"duplicate {group} id {item.id!r}")
            seen.add(key)
            if not all(t.strip() for t in item.any_of):
                errors.append(f"{key}: any_of contains an empty term")

    for fe in ex.fields:
        sec = sections.get(fe.section_id)
        if sec is None:
            errors.append(f"field expectation: unknown section {fe.section_id!r}")
        elif sec.format != "key_value" or fe.key not in {f.key for f in sec.fields}:
            errors.append(f"field expectation: {fe.section_id}.{fe.key} is not a key_value field")
    for fact in ex.facts:
        if fact.section_id is not None:
            sec = sections.get(fact.section_id)
            if sec is None:
                errors.append(f"fact {fact.id}: unknown section {fact.section_id!r}")
            elif sec.format == "key_value":
                errors.append(f"fact {fact.id}: section {fact.section_id!r} is key_value")
        if not any(find_term(transcript, t) for t in fact.any_of if t.strip()):
            errors.append(f"fact {fact.id}: no any_of term occurs in the transcript")
    for sid in ex.not_discussed:
        sec = sections.get(sid)
        if sec is None:
            errors.append(f"not_discussed: unknown section {sid!r}")
        elif sec.missing_behavior == "use_normal_defaults":
            errors.append(f"not_discussed: {sid!r} uses normal defaults (use defaults_expected)")
        if any(f.section_id == sid for f in ex.facts) or any(
            f.section_id == sid for f in ex.fields
        ):
            errors.append(f"not_discussed: {sid!r} also has facts or fields expected")
    for sid in ex.defaults_expected:
        sec = sections.get(sid)
        if sec is None:
            errors.append(f"defaults_expected: unknown section {sid!r}")
        elif sec.missing_behavior != "use_normal_defaults":
            errors.append(f"defaults_expected: {sid!r} does not use normal defaults")
    fact_terms = [normalize_text(t) for f in ex.facts for t in f.any_of]
    for forb in ex.forbidden:
        for term in forb.any_of:
            nt = normalize_text(term)
            if any(find_term(ft, nt) for ft in fact_terms):
                errors.append(f"forbidden {forb.id}: term {term!r} overlaps an expected fact")
    return errors, warnings


def validate_directory(
    directory: Path | str | None = None,
) -> tuple[list[EvalCase], list[str], list[str]]:
    """Load and validate every case; returns ``(cases, errors, warnings)``."""
    d = Path(directory) if directory else DEFAULT_CASES_DIR
    errors: list[str] = []
    warnings: list[str] = []
    cases: list[EvalCase] = []
    ids: set[str] = set()
    for path in sorted(d.glob("*.json")):
        try:
            case = load_case(path)
        except CaseError as exc:
            errors.append(str(exc))
            continue
        errs, warns = validate_case(case, filename=path.name)
        errors += [f"{case.id}: {e}" for e in errs]
        warnings += [f"{case.id}: {w}" for w in warns]
        if case.id in ids:
            errors.append(f"duplicate case id {case.id}")
        ids.add(case.id)
        cases.append(case)
    if not list(d.glob("*.json")):
        errors.append(f"no case files found in {d}")
    return cases, errors, warnings
