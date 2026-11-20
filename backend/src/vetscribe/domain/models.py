"""Pydantic v2 domain models. JSON wire format is snake_case."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

IDENT_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")

AppointmentType = Literal[
    "general",
    "wellness",
    "sick",
    "recheck",
    "dental",
    "surgery",
    "euthanasia",
    "emergency",
    "phone",
    "other",
]
SectionFormat = Literal["paragraph", "bullets", "key_value"]
MissingBehavior = Literal["omit", "state_not_discussed", "use_normal_defaults"]
Tone = Literal["clinical", "client_friendly"]
NoteStatus = Literal["pending", "processing", "completed", "failed"]
ErrorCode = Literal[
    "MODEL_REFUSAL",
    "OUTPUT_TRUNCATED",
    "INVALID_MODEL_OUTPUT",
    "LLM_ERROR",
    "INTERNAL",
]

Ident = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,39}$")]


def utc_now_iso() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FieldDef(_Model):
    key: Ident
    label: str = Field(min_length=1, max_length=80)
    hint: str = Field(default="", max_length=300)


class Section(_Model):
    id: Ident
    title: str = Field(min_length=1, max_length=80)
    instructions: str = Field(default="", max_length=2000)
    format: SectionFormat = "paragraph"
    fields: list[FieldDef] = Field(default_factory=list)
    required: bool = True
    missing_behavior: MissingBehavior = "state_not_discussed"
    normal_defaults: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if self.format == "key_value":
            if not self.fields:
                raise ValueError("key_value sections require at least one field")
            keys = [f.key for f in self.fields]
            if len(set(keys)) != len(keys):
                raise ValueError("field keys must be unique within a section")
        elif self.fields:
            raise ValueError("fields are only allowed when format is key_value")
        return self


class Style(_Model):
    tone: Tone = "clinical"
    use_abbreviations: bool = True
    custom_instructions: str = Field(default="", max_length=2000)


class TemplateInput(_Model):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    appointment_type: AppointmentType = "general"
    species: list[str] = Field(default_factory=list)
    sections: list[Section] = Field(min_length=1, max_length=30)
    style: Style = Field(default_factory=Style)

    @model_validator(mode="after")
    def _unique_sections(self) -> Self:
        ids = [s.id for s in self.sections]
        if len(set(ids)) != len(ids):
            raise ValueError("section ids must be unique within a template")
        return self


class Template(TemplateInput):
    id: str
    is_builtin: bool = False
    version: int = 1
    created_at: str = Field(default_factory=utc_now_iso)
    updated_at: str = Field(default_factory=utc_now_iso)


class Patient(_Model):
    name: str = ""
    species: str = ""
    breed: str = ""
    age: str = ""
    sex: str = ""
    weight: str = ""


class NoteError(_Model):
    code: ErrorCode
    message: str


class ModelInfo(_Model):
    provider: Literal["bedrock", "mock"]
    model_id: str
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0


class ResultField(_Model):
    key: str
    label: str
    value: str = ""


class ResultSection(_Model):
    section_id: str
    title: str
    format: SectionFormat
    content: str = ""
    items: list[str] = Field(default_factory=list)
    fields: list[ResultField] = Field(default_factory=list)
    not_discussed: bool = False
    used_defaults: bool = False


class NoteResult(_Model):
    visit_summary: str = ""
    sections: list[ResultSection] = Field(default_factory=list)
    action_items: list[str] = Field(default_factory=list)
    review_flags: list[str] = Field(default_factory=list)


class Note(_Model):
    id: str
    template_id: str
    template_name: str
    template_snapshot: Template
    patient: Patient = Field(default_factory=Patient)
    clinician: str = ""
    transcript: str
    status: NoteStatus = "pending"
    error: NoteError | None = None
    result: NoteResult | None = None
    edited: bool = False
    model_info: ModelInfo | None = None
    created_at: str = Field(default_factory=utc_now_iso)
    updated_at: str = Field(default_factory=utc_now_iso)


class NoteSummary(_Model):
    id: str
    template_id: str
    template_name: str
    patient: Patient
    status: NoteStatus
    visit_summary: str | None = None
    created_at: str
    updated_at: str

    @classmethod
    def from_note(cls, note: Note) -> NoteSummary:
        summary = note.result.visit_summary if note.result and note.result.visit_summary else None
        return cls(
            id=note.id,
            template_id=note.template_id,
            template_name=note.template_name,
            patient=note.patient,
            status=note.status,
            visit_summary=summary,
            created_at=note.created_at,
            updated_at=note.updated_at,
        )


# ----- API request bodies ---------------------------------------------------------------


class CreateNoteRequest(_Model):
    template_id: str = Field(min_length=1)
    transcript: str
    patient: Patient = Field(default_factory=Patient)
    clinician: str = Field(default="", max_length=200)


class UpdateNoteRequest(_Model):
    result: NoteResult


class RegenerateRequest(_Model):
    template_id: str | None = None


class DuplicateRequest(_Model):
    name: str | None = Field(default=None, min_length=1, max_length=120)
