"""DLQ Lambda: marks notes whose worker invocation failed permanently as ``failed``.

Subscribed (SQS event source, partial batch responses) to the worker's on-failure queue. The
Lambda on-failure destination wraps the original async event under ``requestPayload``; a raw
event body is accepted too.
"""

from __future__ import annotations

import json
from typing import Any

from aws_lambda_powertools.utilities.typing import LambdaContext

from vetscribe.container import get_container
from vetscribe.domain.models import NoteError
from vetscribe.observability import logger, metrics
from vetscribe.services.notes import TIMEOUT_MESSAGE


def _original_event(body: str) -> dict[str, Any] | None:
    try:
        doc = json.loads(body)
        payload = doc.get("requestPayload", doc) if isinstance(doc, dict) else None
        if isinstance(payload, str):
            payload = json.loads(payload)
    except ValueError:
        return None
    return payload if isinstance(payload, dict) else None


@logger.inject_lambda_context(clear_state=True)
@metrics.log_metrics
def lambda_handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    container = get_container()
    failures: list[dict[str, str]] = []
    for record in event.get("Records", []):
        message_id = str(record.get("messageId", ""))
        payload = _original_event(str(record.get("body", "")))
        if not payload or not payload.get("note_id"):
            logger.warning("dlq_message_unparseable", extra={"message_id": message_id})
            continue  # unrecoverable: drop rather than retry forever
        note_id = str(payload["note_id"])
        clinic_id = str(payload.get("clinic_id") or container.settings.default_clinic_id)
        try:
            marked = container.note_service.mark_failed(
                clinic_id,
                note_id,
                str(payload.get("generation_id") or "") or None,
                NoteError(code="GENERATION_TIMEOUT", message=TIMEOUT_MESSAGE),
            )
            logger.info("dlq_message_handled", extra={"note_id": note_id, "marked": marked})
        except Exception as exc:
            logger.error(
                "dlq_message_failed", extra={"note_id": note_id, "error": type(exc).__name__}
            )
            failures.append({"itemIdentifier": message_id})
    return {"batchItemFailures": failures}
