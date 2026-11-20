"""Validate raw model output and turn it into an ordered ``NoteResult``."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from vetscribe.domain.models import NoteResult, ResultField, ResultSection, Section, Template
from vetscribe.errors import GenerationError


class RawSection(BaseModel):
    model_config = ConfigDict(extra="ignore")

    content: str = ""
    items: list[str] = Field(default_factory=list)
    fields: dict[str, str] = Field(default_factory=dict)
    not_discussed: bool = False
    used_defaults: bool = False


class RawOutput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    visit_summary: str
    sections: dict[str, RawSection]
    action_items: list[str] = Field(default_factory=list)
    review_flags: list[str] = Field(default_factory=list)


def _clean(items: list[str]) -> list[str]:
    return [i.strip() for i in items if i and i.strip()]


def _build_section(section: Section, raw: RawSection) -> ResultSection:
    content = raw.content.strip() if section.format == "paragraph" else ""
    items = _clean(raw.items) if section.format == "bullets" else []
    fields: list[ResultField] = []
    if section.format == "key_value":
        fields = [
            ResultField(key=f.key, label=f.label, value=(raw.fields.get(f.key) or "").strip())
            for f in section.fields
        ]

    if section.format == "paragraph":
        empty = not content
    elif section.format == "bullets":
        empty = not items
    else:
        empty = not any(f.value for f in fields)

    used_defaults = False
    if empty:
        defaults = section.normal_defaults.strip()
        if section.missing_behavior == "use_normal_defaults" and defaults:
            if section.format == "paragraph":
                content = defaults
                empty = False
                used_defaults = True
            elif section.format == "bullets":
                items = [defaults]
                empty = False
                used_defaults = True
    elif section.missing_behavior == "use_normal_defaults" and section.normal_defaults.strip():
        # Model mixed findings and defaults; trust its own flag.
        used_defaults = raw.used_defaults

    return ResultSection(
        section_id=section.id,
        title=section.title,
        format=section.format,
        content=content,
        items=items,
        fields=fields,
        not_discussed=empty,
        used_defaults=used_defaults,
    )


def postprocess(raw: dict[str, Any], template: Template) -> NoteResult:
    """Validate ``raw`` against the schema contract and order sections like the template."""
    try:
        parsed = RawOutput.model_validate(raw)
    except ValidationError as exc:
        raise GenerationError(
            "INVALID_MODEL_OUTPUT",
            f"Model output did not match the expected structure ({exc.error_count()} problems).",
        ) from exc

    missing = [s.id for s in template.sections if s.id not in parsed.sections]
    if missing:
        raise GenerationError(
            "INVALID_MODEL_OUTPUT",
            "Model output is missing sections: " + ", ".join(missing),
        )

    return NoteResult(
        visit_summary=parsed.visit_summary.strip(),
        sections=[_build_section(s, parsed.sections[s.id]) for s in template.sections],
        action_items=_clean(parsed.action_items),
        review_flags=_clean(parsed.review_flags),
    )
