from __future__ import annotations

import copy
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
