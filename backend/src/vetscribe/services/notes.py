"""Note lifecycle: create, read, edit, regenerate, delete and the generation job itself."""

from __future__ import annotations

import time

from aws_lambda_powertools.metrics import MetricUnit
from ulid import ULID

from vetscribe.config import Settings
from vetscribe.domain.models import (
    CreateNoteRequest,
    Note,
    NoteError,
    NoteResult,
    NoteSummary,
    utc_now_iso,
)
from vetscribe.domain.postprocess import postprocess
from vetscribe.errors import AppError, GenerationError, not_found, validation_error
from vetscribe.jobs.dispatcher import JobDispatcher
from vetscribe.llm.base import NoteGenerator
from vetscribe.observability import logger, metrics
from vetscribe.repositories.base import NoteRepository
from vetscribe.services.templates import TemplateService


class NoteService:
    def __init__(
        self,
        repo: NoteRepository,
        templates: TemplateService,
        dispatcher: JobDispatcher,
        generator: NoteGenerator,
        settings: Settings,
    ) -> None:
        self._repo = repo
        self._templates = templates
        self._dispatcher = dispatcher
        self._generator = generator
        self._settings = settings

    # -- API operations ----------------------------------------------------------------

    def create(self, clinic_id: str, req: CreateNoteRequest) -> Note:
        transcript = req.transcript
        if not transcript.strip():
            raise validation_error("transcript must not be blank")
        if len(transcript) > self._settings.max_transcript_chars:
            limit = self._settings.max_transcript_chars
            raise validation_error(f"transcript exceeds the maximum of {limit} characters")
        template = self._templates.get(clinic_id, req.template_id)
        note = Note(
            id=str(ULID()),
            template_id=template.id,
            template_name=template.name,
            template_snapshot=template,
            patient=req.patient,
            clinician=req.clinician,
            transcript=transcript,
            status="pending",
        )
        self._repo.put_note(clinic_id, note)
        return self._dispatch(clinic_id, note)

    def _dispatch(self, clinic_id: str, note: Note) -> Note:
        try:
            self._dispatcher.dispatch(note.id, clinic_id)
        except Exception as exc:
            logger.error("dispatch_failed", extra={"note_id": note.id, "error": type(exc).__name__})
            note.status = "failed"
            note.error = NoteError(code="INTERNAL", message="Could not start note generation.")
            note.updated_at = utc_now_iso()
            self._repo.put_note(clinic_id, note)
        return note

    def get(self, clinic_id: str, note_id: str) -> Note:
        note = self._repo.get_note(clinic_id, note_id)
        if note is None:
            raise not_found("Note")
        return note

    def list(self, clinic_id: str, limit: int = 50) -> list[NoteSummary]:
        return [NoteSummary.from_note(n) for n in self._repo.list_notes(clinic_id, limit)]

    def update_result(self, clinic_id: str, note_id: str, result: NoteResult) -> Note:
        note = self.get(clinic_id, note_id)
        if note.status != "completed":
            raise AppError(409, "NOT_COMPLETED", "Only completed notes can be edited")
        note.result = result
        note.edited = True
        note.updated_at = utc_now_iso()
        self._repo.put_note(clinic_id, note)
        return note

    def regenerate(self, clinic_id: str, note_id: str, template_id: str | None = None) -> Note:
        note = self.get(clinic_id, note_id)
        if template_id and template_id != note.template_id:
            template = self._templates.get(clinic_id, template_id)
            note.template_id = template.id
            note.template_name = template.name
            note.template_snapshot = template
        note.status = "pending"
        note.result = None
        note.error = None
        note.edited = False
        note.model_info = None
        note.updated_at = utc_now_iso()
        self._repo.put_note(clinic_id, note)
        return self._dispatch(clinic_id, note)

    def delete(self, clinic_id: str, note_id: str) -> None:
        if not self._repo.delete_note(clinic_id, note_id):
            raise not_found("Note")

    # -- generation job ----------------------------------------------------------------

    def process(self, note_id: str, clinic_id: str) -> None:
        """Run generation for a pending note. Failures are stored on the note."""
        note = self._repo.get_note(clinic_id, note_id)
        if note is None:
            logger.warning("process_note_missing", extra={"note_id": note_id})
            return
        if note.status not in ("pending", "processing"):
            logger.info("process_note_skipped", extra={"note_id": note_id, "status": note.status})
            return

        note.status = "processing"
        note.updated_at = utc_now_iso()
        self._repo.put_note(clinic_id, note)
        started = time.monotonic()
        logger.info(
            "generation_started",
            extra={"note_id": note_id, "transcript_chars": len(note.transcript)},
        )

        result: NoteResult | None = None
        error: NoteError | None = None
        model_info = None
        try:
            gen = self._generator.generate(
                note.template_snapshot, note.transcript, note.patient, note.clinician
            )
            model_info = gen.model_info
            result = postprocess(gen.raw, note.template_snapshot)
        except GenerationError as exc:
            error = NoteError(code=exc.code, message=exc.message)
        except Exception as exc:
            logger.error(
                "generation_unexpected", extra={"note_id": note_id, "error": type(exc).__name__}
            )
            error = NoteError(
                code="INTERNAL", message="Unexpected error while generating the note."
            )

        fresh = self._repo.get_note(clinic_id, note_id)
        if fresh is None:  # deleted while processing
            return
        fresh.status = "failed" if error else "completed"
        fresh.error = error
        fresh.result = result
        fresh.model_info = model_info
        fresh.updated_at = utc_now_iso()
        self._repo.put_note(clinic_id, fresh)

        elapsed_ms = (time.monotonic() - started) * 1000
        logger.info(
            "generation_finished",
            extra={
                "note_id": note_id,
                "status": fresh.status,
                "error_code": error.code if error else None,
                "elapsed_ms": int(elapsed_ms),
            },
        )
        if error:
            metrics.add_metric(name="GenerationFailed", unit=MetricUnit.Count, value=1)
        else:
            metrics.add_metric(name="NotesGenerated", unit=MetricUnit.Count, value=1)
            metrics.add_metric(
                name="GenerationLatencyMs", unit=MetricUnit.Milliseconds, value=elapsed_ms
            )
            if model_info:
                metrics.add_metric(
                    name="InputTokens", unit=MetricUnit.Count, value=model_info.input_tokens
                )
                metrics.add_metric(
                    name="OutputTokens", unit=MetricUnit.Count, value=model_info.output_tokens
                )
