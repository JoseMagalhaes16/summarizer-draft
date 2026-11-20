from __future__ import annotations

from typing import Any

import pytest

from vetscribe.domain.builtin_templates import get_builtin
from vetscribe.domain.models import NoteResult, ResultField, ResultSection
from vetscribe.evals import graders as g
from vetscribe.evals.models import EvalCase, Expectations


def case(**ex: Any) -> EvalCase:
    return EvalCase(
        id="t-01",
        title="t",
        tags=["sick"],
        template_id="builtin-sick",
        transcript="Bella weighs 32 kilograms. Temperature 101.6 Fahrenheit. Malassezia seen.",
        expectations=Expectations(**ex),
    )


def note(
    sections: list[ResultSection] | None = None,
    summary: str = "",
    flags: list[str] | None = None,
    actions: list[str] | None = None,
) -> NoteResult:
    return NoteResult(
        visit_summary=summary,
        sections=sections or [],
        review_flags=flags or [],
        action_items=actions or [],
    )


def vitals(**values: str) -> ResultSection:
    return ResultSection(
        section_id="vitals",
        title="V",
        format="key_value",
        fields=[ResultField(key=k, label=k, value=v) for k, v in values.items()],
    )


def para(sid: str, text: str, **kw: Any) -> ResultSection:
    return ResultSection(section_id=sid, title=sid, format="paragraph", content=text, **kw)


@pytest.mark.parametrize(
    ("expected", "got", "ok"),
    [
        ("34.2 kg", "34.2 kg", True),
        ("34.2 kg", "34.20 kilograms", True),
        ("34.2 kg", "34.2 KGS.", True),
        ("101.6 F", "101.60 degrees Fahrenheit", True),
        ("101.6 F", "101.6 °F", True),
        ("38.9 C", "38.9 celsius", True),
        ("96 bpm", "96 beats per minute", True),
        ("52 lb", "52 pounds", True),
        ("5/9", "5 out of 9", True),
        ("<2 s", "under 2 seconds", True),
        ("pink and moist", "Pink, moist", True),
        ("3:42 pm", "3:42 p.m.", True),
        ("1", "ASA I", True),
        ("", "", True),
        ("", "   ", True),
        # wrong-but-plausible values must fail
        ("34.2 kg", "34.3 kg", False),
        ("34.2 kg", "34.2 lb", False),
        ("52 lb", "23.6 kg", False),
        ("101.6 F", "38.7 C", False),
        ("96 bpm", "69 bpm", False),
        ("5/9", "6/9", False),
        ("1", "ASA II", False),
        # cheating: empty / unrelated text never satisfies a non-empty expectation
        ("34.2 kg", "", False),
        ("34.2 kg", "weight was recorded", False),
        # "must be empty" fields fail when a value is invented
        ("", "96 bpm", False),
    ],
)
def test_values_match(expected: str, got: str, ok: bool) -> None:
    assert g.values_match(expected, got) is ok


def test_normalize_text_numbers_and_units() -> None:
    assert g.normalize_text("Twenty-four breaths per minute") == "24 breaths/min"
    assert g.normalize_text("five milligrams per kilogram") == "5 mg/kg"
    assert g.normalize_text("15 percent") == "15%"


def test_find_term_is_word_start_anchored() -> None:
    assert g.find_term("yeasts seen", "yeast")
    assert not g.find_term("the location", "cat")
    assert not g.find_term("anything", "  ")


def test_field_accuracy_details_and_missing_section() -> None:
    c = case(
        fields=[
            {"section_id": "vitals", "key": "weight", "expected": "32 kg"},
            {"section_id": "vitals", "key": "heart_rate", "expected": ""},
            {"section_id": "vitals", "key": "temperature", "expected": "101.6 F"},
        ]
    )
    score, det = g.grade_field_accuracy(c, note([vitals(weight="32 kilograms", heart_rate="96")]))
    assert score == pytest.approx(1 / 3)
    assert {m["key"] for m in det["field_mismatches"]} == {"heart_rate", "temperature"}
    assert g.grade_field_accuracy(c, note())[0] == pytest.approx(1 / 3)  # only the "" one holds
    assert g.grade_field_accuracy(case(), note())[0] is None


def test_fact_recall_scoping_and_cheats() -> None:
    c = case(
        facts=[
            {"id": "a", "section_id": "assessment", "any_of": ["yeast"]},
            {"id": "b", "section_id": None, "any_of": ["carprofen", "rimadyl"]},
        ]
    )
    # right word, wrong section: scoped fact is missed
    n = note([para("physical_exam", "Yeast seen")], actions=["Dispense Carprofen"])
    score, det = g.grade_fact_recall(c, n)
    assert score == 0.5 and det["missed_facts"] == ["a"]
    assert g.grade_fact_recall(c, note())[0] == 0.0
    # whitespace / empty terms never match
    c2 = case(facts=[{"id": "x", "section_id": None, "any_of": [" "]}])
    assert g.grade_fact_recall(c2, note([para("history", "anything")]))[0] == 0.0


def test_fact_recall_ignores_default_boilerplate() -> None:
    tpl = get_builtin("builtin-sick")
    assert tpl is not None
    pe = next(s for s in tpl.sections if s.id == "physical_exam")
    c = case(facts=[{"id": "murmur", "section_id": None, "any_of": ["murmur"]}])
    filled = para("physical_exam", pe.normal_defaults, used_defaults=True)
    assert "murmur" in pe.normal_defaults.lower()
    assert g.grade_fact_recall(c, note([filled]), tpl)[0] == 0.0
    mixed = para("physical_exam", "Grade 2/6 murmur. " + pe.normal_defaults, used_defaults=True)
    assert g.grade_fact_recall(c, note([mixed]), tpl)[0] == 1.0


def test_hallucination_free_finds_term_anywhere_with_snippet() -> None:
    c = case(forbidden=[{"id": "ab", "any_of": ["amoxicillin"]}])
    assert g.grade_hallucination_free(c, note([para("history", "ok")]))[0] == 1.0
    for n in (
        note([para("history", "Started Amoxicillin 10 mg")]),
        note(summary="amoxicillin given"),
        note(flags=["Amoxicillin dose unclear"]),
        note(actions=["start amoxicillin"]),
    ):
        score, det = g.grade_hallucination_free(c, n)
        assert score == 0.0
        assert det["forbidden_found"][0]["id"] == "ab"
        assert "amoxicillin" in det["forbidden_found"][0]["snippet"]
    assert g.grade_hallucination_free(case(), note())[0] is None


def test_missing_data_uses_raw_declaration() -> None:
    c = case(not_discussed=["history"], defaults_expected=["physical_exam"])
    ok = note(
        [
            para("history", "", not_discussed=True),
            para("physical_exam", "BAR.", used_defaults=True),
        ]
    )
    raw_yes = {"sections": {"physical_exam": {"used_defaults": True}}}
    raw_no = {"sections": {"physical_exam": {"used_defaults": False}}}
    assert g.grade_missing_data(c, ok, raw_yes)[0] == 1.0
    # post-processor filled defaults but the model never declared it -> not credited
    score, det = g.grade_missing_data(c, ok, raw_no)
    assert score == 0.5 and "physical_exam" in det["not_discussed_errors"][0]
    # content written into a not_discussed section fails
    bad = note([para("history", "Dog is itchy", not_discussed=False)])
    assert g.grade_missing_data(case(not_discussed=["history"]), bad)[0] == 0.0
    assert g.grade_missing_data(case(), note())[0] is None


def test_flag_and_action_recall() -> None:
    c = case(
        review_flags=[{"id": "dose", "any_of": ["dose"]}],
        action_items=[
            {"id": "recheck", "any_of": ["recheck"]},
            {"id": "labs", "any_of": ["bloodwork"]},
        ],
    )
    n = note(flags=["Dose unclear"], actions=["Recheck in 2 weeks"])
    assert g.grade_flag_recall(c, n)[0] == 1.0
    score, det = g.grade_action_recall(c, n)
    assert score == 0.5 and det["missing_actions"] == ["labs"]
    # a flag text does not satisfy an action expectation
    assert g.grade_action_recall(c, note(flags=["recheck", "bloodwork"]))[0] == 0.0
    assert g.grade_flag_recall(case(), n)[0] is None


def test_faithfulness_proxy() -> None:
    tpl = get_builtin("builtin-sick")
    assert tpl is not None
    c = case()
    grounded = note([para("history", "Bella weighs 32 kg. Malassezia seen.")])
    assert g.grade_faithfulness(c, grounded, tpl)[0] == 1.0
    wrong_number = note([para("history", "Bella weighs 33 kg.")])
    assert g.grade_faithfulness(c, wrong_number, tpl)[0] == 0.0
    invented = note([para("history", "Dog received cephalexin injection yesterday.")])
    score, det = g.grade_faithfulness(c, invented, tpl)
    assert score == 0.0 and det["unsupported_sentences"]
    assert g.grade_faithfulness(c, note(), tpl)[0] is None


def test_grade_all_returns_every_metric() -> None:
    tpl = get_builtin("builtin-sick")
    assert tpl is not None
    scores, details = g.grade_all(case(), tpl, note())
    assert scores["schema_valid"] == 1.0
    assert set(details) >= {"missed_facts", "forbidden_found", "field_mismatches"}
    assert g.grade_schema_valid(False)[0] == 0.0
