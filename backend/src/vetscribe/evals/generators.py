"""Harness self-test generators.

``OracleGenerator`` builds the perfect raw output for a case from its expectations; it must
score 1.0 on every deterministic metric. ``NullGenerator`` returns an empty note and must score
about 0 on the recall metrics. Both implement ``NoteGenerator`` and flow through the real
post-processor like any model.
"""

from __future__ import annotations

from typing import Any

from vetscribe.domain.models import ModelInfo, Patient, Template
from vetscribe.evals.graders import find_term, normalize_text
from vetscribe.evals.models import EvalCase
from vetscribe.llm.base import GenerationResult


def _pick(terms: list[str], transcript_norm: str) -> str:
    """The first alternative that occurs in the transcript (so the note stays faithful)."""
    for t in terms:
        if t.strip() and find_term(transcript_norm, t):
            return t.strip()
    return terms[0].strip()


def _sentence(term: str) -> str:
    return term[:1].upper() + term[1:] + ("" if term.endswith(".") else ".")


def build_oracle_output(case: EvalCase, template: Template) -> dict[str, Any]:
    ex = case.expectations
    tnorm = normalize_text(case.transcript)
    facts_by_section: dict[str, list[str]] = {}
    unscoped: list[str] = []
    for fact in ex.facts:
        term = _pick(fact.any_of, tnorm)
        if fact.section_id is None:
            unscoped.append(term)
        else:
            facts_by_section.setdefault(fact.section_id, []).append(term)

    # Unscoped facts go into the first free narrative section.
    anchor = next(
        (
            s.id
            for s in template.sections
            if s.format != "key_value" and s.id not in ex.not_discussed
        ),
        None,
    )
    if anchor is not None and unscoped:
        facts_by_section.setdefault(anchor, []).extend(unscoped)

    expected_fields: dict[tuple[str, str], str] = {
        (f.section_id, f.key): f.expected for f in ex.fields
    }
    sections: dict[str, Any] = {}
    for sec in template.sections:
        facts = facts_by_section.get(sec.id, [])
        body: dict[str, Any] = {"content": "", "items": [], "fields": {}}
        if sec.format == "paragraph":
            body["content"] = " ".join(_sentence(t) for t in facts)
        elif sec.format == "bullets":
            body["items"] = [_sentence(t) for t in facts]
        else:
            body["fields"] = {f.key: expected_fields.get((sec.id, f.key), "") for f in sec.fields}
        has_content = bool(facts) or any(body["fields"].values())
        body["used_defaults"] = sec.id in ex.defaults_expected
        body["not_discussed"] = not has_content and sec.id not in ex.defaults_expected
        sections[sec.id] = body

    name = case.patient.name.strip()
    summary = name if name and find_term(tnorm, name) else (unscoped or ["consultation"])[0]
    return {
        "visit_summary": _sentence(summary),
        "sections": sections,
        "action_items": [_sentence(_pick(a.any_of, tnorm)) for a in ex.action_items],
        "review_flags": [
            f"{_sentence(_pick(f.any_of, tnorm))} Please confirm." for f in ex.review_flags
        ],
    }


def build_null_output(template: Template) -> dict[str, Any]:
    sections = {
        s.id: {
            "content": "",
            "items": [],
            "fields": {f.key: "" for f in s.fields},
            "not_discussed": False,
            "used_defaults": False,
        }
        for s in template.sections
    }
    return {"visit_summary": "", "sections": sections, "action_items": [], "review_flags": []}


class OracleGenerator:
    def __init__(self, case: EvalCase) -> None:
        self._case = case

    def generate(
        self,
        template: Template,
        transcript: str,
        patient: Patient,
        clinician: str = "",
        deadline: float | None = None,
    ) -> GenerationResult:
        return GenerationResult(
            raw=build_oracle_output(self._case, template),
            model_info=ModelInfo(provider="mock", model_id="oracle-v1"),
        )


class NullGenerator:
    def generate(
        self,
        template: Template,
        transcript: str,
        patient: Patient,
        clinician: str = "",
        deadline: float | None = None,
    ) -> GenerationResult:
        return GenerationResult(
            raw=build_null_output(template),
            model_info=ModelInfo(provider="mock", model_id="null-v1"),
        )
