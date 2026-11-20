from __future__ import annotations

import copy
import re
from typing import Any

import pytest

from vetscribe.domain.models import Patient, Section, Template
from vetscribe.domain.postprocess import postprocess
from vetscribe.domain.rendering import render_note_markdown, render_note_text
from vetscribe.errors import GenerationError
from vetscribe.llm.mock import MockNoteGenerator
from vetscribe.prompts.builder import build_json_schema

from .conftest import transcript


def _gen(tpl: Template, text: str) -> dict[str, Any]:
    return MockNoteGenerator(0).generate(tpl, text, Patient(name="Bella")).raw


def test_mock_matches_schema_shape_and_extracts_vitals(soap: Template, otitis: str) -> None:
    raw = _gen(soap, otitis)
    schema = build_json_schema(soap)
    assert set(raw) == set(schema["properties"])
    assert set(raw["sections"]) == {s.id for s in soap.sections}
    vit = raw["sections"]["vitals"]["fields"]
    assert vit["weight"].startswith("32")
    assert "101.6" in vit["temperature"]
    assert vit["heart_rate"].startswith("96")
    assert vit["bcs"].replace(" ", "").startswith("5")
    assert raw["visit_summary"]
    assert raw["review_flags"]


@pytest.mark.parametrize("name", ["canine_otitis", "feline_wellness", "canine_dental_preop"])
def test_mock_passes_postprocess_for_all_builtins(name: str) -> None:
    from vetscribe.domain.builtin_templates import list_builtins

    text = transcript(name)
    for tpl in list_builtins():
        result = postprocess(_gen(tpl, text), tpl)
        assert [s.section_id for s in result.sections] == [s.id for s in tpl.sections]
        assert len(result.visit_summary) <= 200


def test_defaults_applied_and_flagged(soap: Template) -> None:
    result = postprocess(_gen(soap, "Owner: hi. Vet: nothing here at all."), soap)
    pe = next(s for s in result.sections if s.section_id == "physical_exam")
    assert pe.used_defaults and pe.content and not pe.not_discussed


def test_missing_behavior_and_rendering() -> None:
    tpl = Template.model_validate(
        {
            "id": "t",
            "name": "T",
            "sections": [
                {"id": "a", "title": "A", "format": "paragraph", "missing_behavior": "omit"},
                {"id": "b", "title": "B", "format": "bullets"},
                {
                    "id": "c",
                    "title": "C",
                    "format": "key_value",
                    "fields": [{"key": "k", "label": "Kay"}],
                },
            ],
        }
    )
    raw = {
        "visit_summary": " Sum ",
        "sections": {
            "c": {"fields": {"k": " v "}},
            "b": {"items": ["", "  "]},
            "a": {"content": "", "not_discussed": True},
        },
        "action_items": ["x", " "],
        "review_flags": [],
    }
    res = postprocess(raw, tpl)
    assert [s.section_id for s in res.sections] == ["a", "b", "c"]
    assert res.sections[0].not_discussed and res.sections[1].not_discussed
    assert res.sections[2].fields[0].value == "v" and res.action_items == ["x"]
    md = render_note_markdown(res, tpl)
    assert "## A\n" not in md and "## B\nNot discussed." in md and "Kay: v" in md
    assert "- [ ] x" in md
    txt = render_note_text(res, tpl)
    assert "B\nNot discussed." in txt and "\nA\n" not in txt


def test_markdown_flags_and_defaults(soap: Template) -> None:
    res = postprocess(_gen(soap, "nothing"), soap)
    res.review_flags = ["check dose"]
    md = render_note_markdown(res, soap)
    assert "defaults - confirm" in md and "## Review flags\n- check dose" in md
    assert "REVIEW FLAGS" in render_note_text(res, soap)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda r: r.pop("visit_summary"),
        lambda r: r.__setitem__("sections", "nope"),
        lambda r: r["sections"].pop("plan"),
        lambda r: r["sections"]["plan"].__setitem__("items", "not a list"),
    ],
)
def test_invalid_output(soap: Template, otitis: str, mutate: Any) -> None:
    raw = copy.deepcopy(_gen(soap, otitis))
    mutate(raw)
    with pytest.raises(GenerationError) as ei:
        postprocess(raw, soap)
    assert ei.value.code == "INVALID_MODEL_OUTPUT"


def test_use_defaults_bullets_and_keyvalue() -> None:
    tpl = Template.model_validate(
        {
            "id": "t",
            "name": "T",
            "sections": [
                Section(
                    id="b",
                    title="B",
                    format="bullets",
                    missing_behavior="use_normal_defaults",
                    normal_defaults="Normal",
                ).model_dump(),
                Section(
                    id="p",
                    title="P",
                    format="paragraph",
                    missing_behavior="use_normal_defaults",
                    normal_defaults="Norm",
                ).model_dump(),
            ],
        }
    )
    raw = {
        "visit_summary": "s",
        "sections": {"b": {"items": []}, "p": {"content": "Abn", "used_defaults": True}},
    }
    res = postprocess(raw, tpl)
    assert res.sections[0].items == ["Normal"] and res.sections[0].used_defaults
    assert res.sections[1].content == "Abn" and res.sections[1].used_defaults


def test_mock_latency_and_long_summary() -> None:
    from vetscribe.domain.builtin_templates import get_builtin

    tpl = get_builtin("builtin-soap")
    assert tpl
    long = "word " * 100 + "end."
    gen = MockNoteGenerator(0.01).generate(tpl, long, Patient())
    assert len(gen.raw["visit_summary"]) <= 160
    assert gen.model_info.provider == "mock"
    empty = MockNoteGenerator(0).generate(tpl, "", Patient())
    assert empty.raw["visit_summary"]


# ---- not_discussed honoured --------------------------------------------------------------


def test_not_discussed_clears_content_unless_defaults() -> None:
    tpl = Template.model_validate(
        {
            "id": "t",
            "name": "T",
            "sections": [
                {"id": "p", "title": "P", "format": "paragraph"},
                {"id": "b", "title": "B", "format": "bullets"},
                {
                    "id": "k",
                    "title": "K",
                    "format": "key_value",
                    "fields": [{"key": "a", "label": "A"}],
                },
                {
                    "id": "d",
                    "title": "D",
                    "format": "paragraph",
                    "missing_behavior": "use_normal_defaults",
                    "normal_defaults": "Normal",
                },
            ],
        }
    )
    raw = {
        "visit_summary": "s",
        "sections": {
            "p": {"content": "invented", "not_discussed": True},
            "b": {"items": ["invented"], "not_discussed": True},
            "k": {"fields": {"a": "invented"}, "not_discussed": True},
            "d": {"content": "", "not_discussed": True},
        },
    }
    res = postprocess(raw, tpl)
    p, b, k, d = res.sections
    assert p.not_discussed and p.content == ""
    assert b.not_discussed and b.items == []
    assert k.not_discussed and [f.value for f in k.fields] == [""] and k.fields[0].label == "A"
    assert d.content == "Normal" and d.used_defaults and not d.not_discussed


def test_postprocess_oversized_output_is_invalid() -> None:
    tpl = Template.model_validate({"id": "t", "name": "T", "sections": [{"id": "p", "title": "P"}]})
    raw = {"visit_summary": "s" * 900, "sections": {"p": {"content": "ok"}}}
    assert len(postprocess(raw, tpl).visit_summary) == 500  # summary is trimmed
    raw["sections"] = {"p": {"content": "x" * 20_001}}
    with pytest.raises(GenerationError) as ei:
        postprocess(raw, tpl)
    assert ei.value.code == "INVALID_MODEL_OUTPUT"


# ---- mock quality -----------------------------------------------------------------------


def _tpl(tid: str) -> Template:
    from vetscribe.domain.builtin_templates import get_builtin

    tpl = get_builtin(tid)
    assert tpl
    return tpl


def _all_text(raw: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for sec in raw["sections"].values():
        out += [sec.get("content", ""), *sec.get("items", []), *sec.get("fields", {}).values()]
    return [t for t in out if t]


def test_mock_feline_wellness_uses_todays_weight_and_clean_vitals() -> None:
    tpl = _tpl("builtin-wellness")
    raw = MockNoteGenerator(0).generate(tpl, transcript("feline_wellness"), Patient()).raw
    vit = raw["sections"]["vitals"]["fields"]
    assert vit["weight"] == "4.9 kg"  # not last visit's 5.8 kg
    assert vit["temperature"] == "101.8°F"
    assert vit["heart_rate"] == "220 bpm" and vit["resp_rate"] == "32 breaths/min"
    assert vit["bcs"] == "4/9" and vit["mm"] == "pink"
    assert vit["crt"] == "less than two seconds"
    assert vit["pain_score"] == ""  # not found: empty, never a sentence
    for value in vit.values():
        assert len(value.split()) <= 4 and ". " not in value


@pytest.mark.parametrize("name", ["canine_otitis", "feline_wellness", "canine_dental_preop"])
def test_mock_content_hygiene(name: str) -> None:
    from vetscribe.domain.builtin_templates import list_builtins

    text = transcript(name)
    for tpl in list_builtins():
        raw = _gen(tpl, text)
        used: list[str] = []
        for sec in raw["sections"].values():
            used += [*sec.get("items", [])]
            if sec.get("content") and not sec.get("used_defaults"):
                used.append(sec["content"])
        joined = " ".join(_all_text(raw))
        assert "?" not in joined, (name, tpl.id)
        assert not re.search(r"\b(?:Hi|Hello|Thanks|Thank you|Good morning)\b", joined)
        # each transcript sentence appears in at most one narrative section
        seen: dict[str, str] = {}
        for sid, sec in raw["sections"].items():
            parts = [*sec.get("items", [])]
            if sec.get("content"):
                parts += re.split(r"(?<=[.!?])\s+", sec["content"])
            for part in parts:
                if len(part.split()) >= 4 and part in text.replace("\n", " "):
                    assert seen.setdefault(part, sid) == sid, (tpl.id, part)


def test_mock_key_value_never_dumps_sentences() -> None:
    tpl = Template.model_validate(
        {
            "id": "t",
            "name": "T",
            "sections": [
                {
                    "id": "kv",
                    "title": "KV",
                    "format": "key_value",
                    "fields": [
                        {"key": "diet", "label": "Diet"},
                        {"key": "weight", "label": "Weight"},
                        {"key": "asa_class", "label": "ASA class"},
                        {"key": "appetite", "label": "Appetite"},
                        {"key": "pain_score", "label": "Pain score"},
                        {"key": "bcs", "label": "BCS"},
                        {"key": "crt", "label": "CRT"},
                        {"key": "mm", "label": "MM"},
                        {"key": "hr", "label": "HR"},
                        {"key": "rr", "label": "RR"},
                        {"key": "temp", "label": "Temp"},
                    ],
                }
            ],
        }
    )
    text = (
        "Vet: Diet is chicken based kibble, plus a spoon of wet food every evening for dinner. "
        "Appetite was good. He weighs 10 lbs today but weighed 12 pounds last month. "
        "He'll be an ASA 2 patient. Pain score 3 out of 4. BCS 6. CRT <2s. Gums pale and tacky. "
        "HR 120. RR 30. Temp 38.6 degrees Celsius. Nothing else of note here."
    )
    vals = MockNoteGenerator(0).generate(tpl, text, Patient()).raw["sections"]["kv"]["fields"]
    assert vals["diet"] == "chicken based kibble"  # stops at the comma: at most a short phrase
    assert vals["appetite"] == "good"
    assert vals["weight"] == "10 lb"
    assert vals["asa_class"] == "II"
    assert vals["pain_score"] == "3/4"
    assert vals["bcs"] == "6/9" or vals["bcs"] == ""
    assert vals["crt"] == "<2s"
    assert vals["mm"] == "pale and tacky"
    assert vals["hr"] == "120 bpm" and vals["rr"] == "30 breaths/min"
    assert vals["temp"] == "38.6°C"
    empty = MockNoteGenerator(0).generate(tpl, "Nothing measured at all today.", Patient()).raw
    assert not any(empty["sections"]["kv"]["fields"].values())
    assert empty["sections"]["kv"]["not_discussed"] is True


def test_mock_weight_fallback_is_last_mention() -> None:
    tpl = _tpl("builtin-soap")
    text = "He was 6 kg in spring. Later he was 7 kg. Nothing else."
    raw = MockNoteGenerator(0).generate(tpl, text, Patient()).raw
    assert raw["sections"]["vitals"]["fields"]["weight"] == "7 kg"


def test_mock_visit_summary_name_species_and_no_greeting() -> None:
    tpl = _tpl("builtin-wellness")
    text = transcript("feline_wellness")
    raw = MockNoteGenerator(0).generate(tpl, text, Patient(name="Miso", species="Feline")).raw
    summary = raw["visit_summary"]
    assert summary.startswith("Miso, feline: wellness exam — ")
    assert "lost weight" in summary and len(summary) <= 160
    assert not re.search(r"\b(hi|hello|thanks|thank you)\b", summary, re.I)
    # Name and species are inferred from the transcript when the form is empty.
    inferred = MockNoteGenerator(0).generate(tpl, text, Patient()).raw["visit_summary"]
    assert inferred.startswith("Miso, feline:")
    dental = MockNoteGenerator(0).generate(
        _tpl("builtin-dental"), transcript("canine_dental_preop"), Patient()
    )
    assert dental.raw["visit_summary"].startswith("Max, canine: dental consult")
    otitis = MockNoteGenerator(0).generate(
        _tpl("builtin-sick"), transcript("canine_otitis"), Patient()
    )
    assert otitis.raw["visit_summary"].startswith("Bella, canine: sick visit — shaking her head")
    anon = MockNoteGenerator(0).generate(_tpl("builtin-soap"), "Nothing to see.", Patient())
    assert anon.raw["visit_summary"].startswith("Patient: general consult")
    assert len(anon.raw["visit_summary"]) <= 160


def test_mock_use_normal_defaults_wording() -> None:
    tpl = _tpl("builtin-soap")
    raw = MockNoteGenerator(0).generate(tpl, transcript("canine_otitis"), Patient()).raw
    pe = raw["sections"]["physical_exam"]
    assert pe["used_defaults"] is True
    assert "Other systems not mentioned:" in pe["content"]
    assert "Heart and lungs sound normal." in pe["content"]


def test_mock_action_items_and_review_flags() -> None:
    raw = (
        MockNoteGenerator(0)
        .generate(_tpl("builtin-sick"), transcript("canine_otitis"), Patient())
        .raw
    )
    actions = raw["action_items"]
    assert 1 <= len(actions) <= 6
    assert not any(a.lower().startswith(("so ", "okay", "let's")) for a in actions)
    assert "Book the recheck for two weeks from today" in actions
    assert any("recheck both ears" in a for a in actions)
    assert "Confirm dose for: carprofen" in raw["review_flags"]
    assert any("mock generator" in f for f in raw["review_flags"])
    dental = _gen(_tpl("builtin-dental"), transcript("canine_dental_preop"))
    assert not any("pimobendan" in f for f in dental["review_flags"])  # dose was stated
    assert any("pimobendan" in a for a in dental["action_items"])


def test_required_section_not_covered_is_flagged_once() -> None:
    tpl = Template.model_validate(
        {
            "id": "t",
            "name": "T",
            "sections": [
                {"id": "plan", "title": "Plan", "format": "bullets", "required": True},
                {"id": "diet", "title": "Diet", "format": "paragraph", "required": False},
                {
                    "id": "exam",
                    "title": "Exam",
                    "format": "paragraph",
                    "required": True,
                    "missing_behavior": "use_normal_defaults",
                    "normal_defaults": "BAR",
                },
            ],
        }
    )
    flag = "Required section not covered in the transcript: Plan"
    raw = {
        "visit_summary": "x",
        "sections": {
            "plan": {"items": [], "not_discussed": True},
            "diet": {"content": "", "not_discussed": True},
            "exam": {"content": "", "not_discussed": True},
        },
        "review_flags": [flag],
    }
    result = postprocess(raw, tpl)
    # Required + empty -> flagged (not duplicated); optional empty -> no flag;
    # required but filled with normal defaults -> not "not covered" (defaults are flagged instead).
    assert result.review_flags == [flag]
    assert result.sections[2].used_defaults is True


def test_prompt_tells_model_about_uncovered_information() -> None:
    from vetscribe.prompts.builder import SYSTEM_PROMPT

    assert "Not captured by this" in SYSTEM_PROMPT
    assert 'required="true"' in SYSTEM_PROMPT
