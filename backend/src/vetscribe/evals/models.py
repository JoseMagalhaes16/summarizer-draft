"""Pydantic models for eval cases, run configuration, per-row results and summaries."""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from vetscribe.domain.models import ModelInfo, NoteResult, Patient

CASE_ID_RE = re.compile(r"^[a-z][a-z0-9-]{1,63}$")

Provider = Literal["mock", "bedrock", "oracle", "null"]
RunStatus = Literal["running", "completed", "failed"]
ResultStatus = Literal["ok", "refused", "truncated", "invalid", "error"]

# Every metric the harness can emit, in display order.
METRIC_KEYS = (
    "schema_valid",
    "field_accuracy",
    "fact_recall",
    "hallucination_free",
    "missing_data_handling",
    "flag_recall",
    "action_recall",
    "faithfulness_proxy",
    "judge_faithfulness",
    "judge_completeness",
    "judge_style_adherence",
)
# Metrics whose per-row value is 0 or 1 (Wilson interval); the rest use a seeded bootstrap.
BINARY_METRICS = frozenset({"schema_valid", "hallucination_free"})


class _M(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FieldExpectation(_M):
    section_id: str
    key: str
    expected: str


class FactExpectation(_M):
    id: str
    section_id: str | None = None
    any_of: list[str] = Field(min_length=1)


class ForbiddenExpectation(_M):
    id: str
    any_of: list[str] = Field(min_length=1)


class KeywordExpectation(_M):
    id: str
    any_of: list[str] = Field(min_length=1)


class Expectations(_M):
    fields: list[FieldExpectation] = Field(default_factory=list)
    facts: list[FactExpectation] = Field(default_factory=list)
    forbidden: list[ForbiddenExpectation] = Field(default_factory=list)
    not_discussed: list[str] = Field(default_factory=list)
    defaults_expected: list[str] = Field(default_factory=list)
    review_flags: list[KeywordExpectation] = Field(default_factory=list)
    action_items: list[KeywordExpectation] = Field(default_factory=list)

    def counts(self) -> dict[str, int]:
        return {name: len(getattr(self, name)) for name in type(self).model_fields}


class GroundTruth(_M):
    source: str = "human-written"
    verified_by_vet: bool = False
    notes: str = ""


class EvalCase(_M):
    id: str
    title: str
    tags: list[str] = Field(min_length=1)
    template_id: str
    patient: Patient = Field(default_factory=Patient)
    transcript: str = ""
    transcript_file: str | None = None
    ground_truth: GroundTruth = Field(default_factory=GroundTruth)
    expectations: Expectations = Field(default_factory=Expectations)

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        if not CASE_ID_RE.match(v):
            raise ValueError("case id must be lowercase letters, digits and hyphens")
        return v

    @model_validator(mode="after")
    def _has_transcript(self) -> EvalCase:
        if not self.transcript.strip() and not self.transcript_file:
            raise ValueError("a case needs `transcript` or `transcript_file`")
        return self

    def summary(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "tags": self.tags,
            "template_id": self.template_id,
            "verified_by_vet": self.ground_truth.verified_by_vet,
            "expectation_counts": self.expectations.counts(),
        }

    def detail(self) -> dict[str, Any]:
        return self.model_dump(mode="json", exclude={"transcript_file"})


class RunConfig(_M):
    label: str = Field(default="", max_length=120)
    provider: Provider = "mock"
    model_id: str | None = None
    structured_mode: Literal["output_config", "tool"] | None = None
    effort: Literal["low", "medium", "high"] | None = None
    reps: int = Field(default=2, ge=1, le=20)
    case_ids: list[str] | None = None
    tags: list[str] | None = None
    judge: bool = False
    judge_model_id: str | None = None
    seed: int = 0
    concurrency: int = Field(default=4, ge=1, le=16)
    case_timeout_s: float = Field(default=600.0, gt=0)

    @field_validator("model_id", "judge_model_id", mode="before")
    @classmethod
    def _blank_to_none(cls, v: Any) -> Any:
        return None if isinstance(v, str) and not v.strip() else v


class MetricStat(_M):
    mean: float
    ci_low: float
    ci_high: float
    n: int


class Percentiles(_M):
    p50: float = 0.0
    p95: float = 0.0


class Progress(_M):
    done: int = 0
    total: int = 0


class RunSummary(_M):
    run_id: str
    status: RunStatus = "running"
    config: RunConfig
    created_at: str
    finished_at: str | None = None
    progress: Progress = Field(default_factory=Progress)
    case_count: int = 0
    metrics: dict[str, MetricStat] = Field(default_factory=dict)
    by_tag: dict[str, dict[str, MetricStat]] = Field(default_factory=dict)
    errors_count: int = 0
    refusal_rate: float = 0.0
    truncated_count: int = 0
    input_tokens: Percentiles = Field(default_factory=Percentiles)
    output_tokens: Percentiles = Field(default_factory=Percentiles)
    latency_ms: Percentiles = Field(default_factory=Percentiles)
    total_cost: float | None = None
    noise_floor: float | None = None
    # Extras beyond the UI contract (ignored by the frontend).
    hallucination_failures: list[str] = Field(default_factory=list)
    served_model_ids: list[str] = Field(default_factory=list)
    error: str | None = None


class CaseResult(_M):
    """One graded (case, rep) row; also used for infra-error rows (status "error")."""

    run_id: str = ""
    case_id: str
    case_title: str = ""
    tags: list[str] = Field(default_factory=list)
    rep: int
    status: ResultStatus
    stop_reason: str | None = None
    failure_class: str | None = None
    message: str | None = None
    attempts: int = 1
    model_id: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0
    cost_usd: float | None = None
    scores: dict[str, float | None] = Field(default_factory=dict)
    details: dict[str, Any] = Field(default_factory=dict)
    result: NoteResult | None = None
    raw: dict[str, Any] | None = None
    model_info: ModelInfo | None = None
    judge: dict[str, Any] | None = None
