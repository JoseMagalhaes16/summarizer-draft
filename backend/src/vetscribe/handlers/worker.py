"""Worker Lambda: generates a note.

Event: ``{"note_id": ..., "clinic_id": ..., "generation_id": ...}`` (async invoke).
"""

from __future__ import annotations

import time
from typing import Any

from aws_lambda_powertools.utilities.typing import LambdaContext

from vetscribe.container import get_container
from vetscribe.observability import logger, metrics

# Seconds kept in reserve before the Lambda timeout for the final save / failure marking.
DEADLINE_RESERVE_S = 30


@logger.inject_lambda_context(clear_state=True)
@metrics.log_metrics
def lambda_handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    container = get_container()
    note_id = str(event["note_id"])
    clinic_id = str(event.get("clinic_id") or container.settings.default_clinic_id)
    generation_id = str(event.get("generation_id") or "")
    logger.append_keys(note_id=note_id)
    deadline = time.monotonic() + context.get_remaining_time_in_millis() / 1000 - DEADLINE_RESERVE_S
    container.note_service.process(note_id, clinic_id, generation_id, deadline=deadline)
    return {"ok": True, "note_id": note_id}
