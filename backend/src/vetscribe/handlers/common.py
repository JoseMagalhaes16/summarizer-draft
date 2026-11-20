"""Small response helpers shared by the HTTP route modules."""

from __future__ import annotations

import json
from typing import Any

from aws_lambda_powertools.event_handler import Response, content_types
from pydantic import ValidationError

from vetscribe.errors import AppError, validation_error


def json_response(status: int, payload: Any) -> Response[str]:
    return Response(
        status_code=status,
        content_type=content_types.APPLICATION_JSON,
        body=json.dumps(payload),
    )


def pydantic_error(exc: ValidationError) -> AppError:
    details = [
        {"loc": [str(p) for p in e["loc"]], "message": e["msg"], "type": e["type"]}
        for e in exc.errors()
    ]
    return validation_error("Request validation failed", details)
