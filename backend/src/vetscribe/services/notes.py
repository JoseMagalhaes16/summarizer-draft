"""Note lifecycle: create, read, edit, regenerate, delete and the generation job itself."""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime

from aws_lambda_powertools.metrics import MetricUnit
from ulid import ULID

from vetscribe.config import Settings
from vetscribe.domain.models import (
    CreateNoteRequest,
    Note,
    NoteError,
    NoteResult,
    NoteSummary,
    Template,
    utc_now_iso,
)
from vetscribe.domain.postprocess import postprocess
from vetscribe.errors import (
    AppError,
    GenerationError,
    PayloadTooLargeError,
    not_found,
    validation_error,
)
from vetscribe.jobs.dispatcher import JobDispatcher
from vetscribe.llm.base import NoteGenerator
from vetscribe.observability import logger, metrics
from vetscribe.repositories.base import NoteRepository
from vetscribe.services.templates import TemplateService

_ACTIVE = ("pending", "processing")
TIMEOUT_MESSAGE = "Generation did not finish. Try regenerating."


def _new_generation_id() -> str:
    return uuid.uuid4().hex


def _age_seconds(iso: str) -> float:
    try:
        then = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return 0.0
    if then.tzinfo is None:
        then = then.replace(tzinfo=UTC)
    return (datetime.now(UTC) - then).total_seconds()


def check_result_matches_template(result: NoteResult, template: Template) -> None:
    """A PATCHed result must have exactly the snapshot's sections / formats / field keys."""
    problems: list[dict[str, object]] = []
    want = [s.id for s in template.sections]
    got = [s.section_id for s in result.sections]
    if got != want:
        problems.append(
            {"loc": ["result", "sections"], "message": f"section ids must be exactly {want}"}
        )
    else:
        for i, (sec, tsec) in enumerate(zip(result.sections, template.sections, strict=True)):
            if sec.format != tsec.format:
                problems.append(
                    {
                        "loc": ["result", "sections", str(i), "format"],
                        "message": f"format must be {tsec.format!r}",
                    }
                )
            elif tsec.format == "key_value":
                keys = sorted(f.key for f in sec.fields)
                if keys != sorted(f.key for f in tsec.fields):
                    problems.append(
                        {
                            "loc": ["result", "sections", str(i), "fields"],
                            "message": "field keys must equal the template's: "
                            + ", ".join(f.key for f in tsec.fields),
                        }
                    )
    if problems:
        raise validation_error("Result does not match the note's template", problems)


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
            generation_id=_new_generation_id(),
            status="pending",
        )
        self._repo.put_note(clinic_id, note)
        return self._dispatch(clinic_id, note)

    def _dispatch(self, clinic_id: str, note: Note) -> Note:
        assert note.generation_id is not None
        try:
            self._dispatcher.dispatch(note.id, clinic_id, note.generation_id)
        except Exception as exc:
            logger.error("dispatch_failed", extra={"note_id": note.id, "error": type(exc).__name__})
            note.status = "failed"
            note.error = NoteError(code="INTERNAL", message="Could not start note generation.")
            note.updated_at = utc_now_iso()
            self._repo.save_if_generation(clinic_id, note, note.generation_id)
        return note

    def _expire_if_stale(self, clinic_id: str, note: Note) -> Note | None:
        """Safety net: report (and persist) a long-silent pending/processing note as timed out."""
        if note.status not in _ACTIVE:
            return note
        if _age_seconds(note.updated_at) <= self._settings.stale_generation_seconds:
            return note
        logger.warning("stale_generation_expired", extra={"note_id": note.id})
        note.status = "failed"
        note.error = NoteError(code="GENERATION_TIMEOUT", message=TIMEOUT_MESSAGE)
        note.result = None
        note.updated_at = utc_now_iso()
        if self._repo.save_if_generation(clinic_id, note, note.generation_id):
            metrics.add_metric(name="GenerationFailed", unit=MetricUnit.Count, value=1)
            return note
        return self._repo.get_note(clinic_id, note.id)  # changed under us: report what is stored

    def get(self, clinic_id: str, note_id: str) -> Note:
        note = self._repo.get_note(clinic_id, note_id)
        if note is not None:
            note = self._expire_if_stale(clinic_id, note)
        if note is None:
            raise not_found("Note")
        return note

    def list(self, clinic_id: str, limit: int = 50) -> list[NoteSummary]:
        out: list[NoteSummary] = []
        for summary in self._repo.list_note_summaries(clinic_id, limit):
            if (
                summary.status in _ACTIVE
                and _age_seconds(summary.updated_at) > self._settings.stale_generation_seconds
            ):
                full = self._repo.get_note(clinic_id, summary.id)
                full = self._expire_if_stale(clinic_id, full) if full else None
                if full is None:
                    continue
                summary = NoteSummary.from_note(full)
            out.append(summary)
        return out

    def _conflict(self, clinic_id: str, note_id: str, code: str, message: str) -> AppError:
        if self._repo.get_note(clinic_id, note_id) is None:
            return not_found("Note")
        return AppError(409, code, message)

    def update_result(self, clinic_id: str, note_id: str, result: NoteResult) -> Note:
        note = self.get(clinic_id, note_id)
        if note.status != "completed":
            raise AppError(409, "NOT_COMPLETED", "Only completed notes can be edited")
        check_result_matches_template(result, note.template_snapshot)
        expected = note.generation_id
        note.result = result
        note.edited = True
        note.updated_at = utc_now_iso()
        if not self._repo.save_if_generation(clinic_id, note, expected):
            raise self._conflict(
                clinic_id, note_id, "NOTE_CHANGED", "The note was regenerated; reload and retry"
            )
        return note

    def regenerate(self, clinic_id: str, note_id: str, template_id: str | None = None) -> Note:
        note = self.get(clinic_id, note_id)
        if note.status in _ACTIVE:
            raise AppError(409, "GENERATION_IN_PROGRESS", "This note is already being generated")
        previous = note.generation_id
        if template_id and template_id != note.template_id:
            template = self._templates.get(clinic_id, template_id)
            note.template_id = template.id
            note.template_name = template.name
            note.template_snapshot = template
        note.generation_id = _new_generation_id()
        note.status = "pending"
        note.result = None
        note.error = None
        note.edited = False
        note.model_info = None
        note.updated_at = utc_now_iso()
        if not self._repo.save_if_generation(clinic_id, note, previous):
            raise self._conflict(
                clinic_id,
                note_id,
                "GENERATION_IN_PROGRESS",
                "This note is already being generated",
            )
        return self._dispatch(clinic_id, note)

    def delete(self, clinic_id: str, note_id: str) -> None:
        if not self._repo.delete_note(clinic_id, note_id):
            raise not_found("Note")

    # -- generation job ----------------------------------------------------------------

    def mark_failed(
        self, clinic_id: str, note_id: str, generation_id: str | None, error: NoteError
    ) -> bool:
        """Mark a pending/processing note failed, only if it still has ``generation_id``.

        Returns True when the failure was written; False for a stale / missing / finished note.
        """
        note = self._repo.get_note(clinic_id, note_id)
        if note is None or note.generation_id != generation_id or note.status not in _ACTIVE:
            logger.info("stale_generation_skipped", extra={"note_id": note_id, "phase": "fail"})
            return False
        note.status = "failed"
        note.error = error
        note.result = None
        note.model_info = None
        note.updated_at = utc_now_iso()
        if not self._repo.save_if_generation(clinic_id, note, generation_id):
            logger.info("stale_generation_skipped", extra={"note_id": note_id, "phase": "fail"})
            return False
        metrics.add_metric(name="GenerationFailed", unit=MetricUnit.Count, value=1)
        return True

    def process(
        self,
        note_id: str,
        clinic_id: str,
        generation_id: str,
        deadline: float | None = None,
    ) -> None:
        """Run generation for a pending note. Failures are stored on the note.

        Every write is conditional on ``generation_id`` still being current; a superseded or
        deleted note makes this a no-op. Any unexpected exception marks the note ``failed``.
        """
        try:
            self._process(note_id, clinic_id, generation_id, deadline)
        except Exception as exc:
            logger.error(
                "generation_unexpected", extra={"note_id": note_id, "error": type(exc).__name__}
            )
            error = NoteError(
                code="INTERNAL", message="Unexpected error while generating the note."
            )
            try:
                self.mark_failed(clinic_id, note_id, generation_id, error)
            except Exception as save_exc:
                logger.error(
                    "failure_save_failed",
                    extra={"note_id": note_id, "error": type(save_exc).__name__},
                )
                raise

    def _process(
        self, note_id: str, clinic_id: str, generation_id: str, deadline: float | None
    ) -> None:
        note = self._repo.get_note(clinic_id, note_id)
        if note is None:
            logger.warning("process_note_missing", extra={"note_id": note_id})
            return
        if note.generation_id != generation_id:
            logger.info("stale_generation_skipped", extra={"note_id": note_id, "phase": "start"})
            return
        if note.status not in _ACTIVE:
            logger.info("process_note_skipped", extra={"note_id": note_id, "status": note.status})
            return

        note.status = "processing"
        note.updated_at = utc_now_iso()
        if not self._repo.save_if_generation(clinic_id, note, generation_id):
            logger.info("stale_generation_skipped", extra={"note_id": note_id, "phase": "start"})
            return
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
                note.template_snapshot,
                note.transcript,
                note.patient,
                note.clinician,
                deadline=deadline,
            )
            model_info = gen.model_info
            result = postprocess(gen.raw, note.template_snapshot)
        except GenerationError as exc:
            error = NoteError(code=exc.code, message=exc.message)

        note.status = "failed" if error else "completed"
        note.error = error
        note.result = None if error else result
        note.model_info = model_info
        note.updated_at = utc_now_iso()
        try:
            saved = self._repo.save_if_generation(clinic_id, note, generation_id)
        except PayloadTooLargeError:
            error = NoteError(
                code="PAYLOAD_TOO_LARGE", message="The generated note is too large to store."
            )
            note.status, note.error, note.result = "failed", error, None
            saved = self._repo.save_if_generation(clinic_id, note, generation_id)
        if not saved:  # deleted or regenerated while we were generating
            logger.info("stale_generation_skipped", extra={"note_id": note_id, "phase": "finish"})
            return

        elapsed_ms = (time.monotonic() - started) * 1000
        logger.info(
            "generation_finished",
            extra={
                "note_id": note_id,
                "status": note.status,
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
