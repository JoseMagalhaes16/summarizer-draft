"""LLM abstraction: a generator returns the *raw* structured dict plus usage info."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from vetscribe.domain.models import ModelInfo, Patient, Template


@dataclass(frozen=True)
class GenerationResult:
    raw: dict[str, Any]
    model_info: ModelInfo


class NoteGenerator(Protocol):
    def generate(
        self,
        template: Template,
        transcript: str,
        patient: Patient,
        clinician: str = "",
        deadline: float | None = None,
    ) -> GenerationResult:
        """``deadline``: optional ``time.monotonic()`` value by which the caller must be done."""
        ...
