"""API Lambda (API Gateway HTTP API v2.0 payload) using Powertools' HTTP resolver."""

from __future__ import annotations

import json
from typing import Any, TypeVar

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver, Response, content_types
from aws_lambda_powertools.event_handler.api_gateway import CORSConfig
from aws_lambda_powertools.utilities.typing import LambdaContext
from pydantic import BaseModel, ValidationError

from vetscribe.config import Settings
from vetscribe.container import get_container
from vetscribe.domain.models import (
    CreateNoteRequest,
    DuplicateRequest,
    Note,
    RegenerateRequest,
    TemplateInput,
    UpdateNoteRequest,
)
from vetscribe.domain.rendering import render_note_markdown, render_note_text
from vetscribe.errors import AppError, validation_error
from vetscribe.handlers.common import pydantic_error as _pydantic_error
from vetscribe.handlers.evals_routes import router as evals_router
from vetscribe.observability import logger, metrics

M = TypeVar("M", bound=BaseModel)


def _json(status: int, payload: Any) -> Response[str]:
    return Response(
        status_code=status,
        content_type=content_types.APPLICATION_JSON,
        body=json.dumps(payload),
    )


def _empty(status: int = 204) -> Response[str]:
    return Response(status_code=status, content_type=content_types.APPLICATION_JSON, body="")


def _error(status: int, code: str, message: str, details: list[Any] | None = None) -> Response[str]:
    return _json(status, AppError(status, code, message, details).body())


def _note_json(note: Note, *, rendered: bool = False) -> dict[str, Any]:
    data = note.model_dump(mode="json")
    if rendered and note.status == "completed" and note.result is not None:
        data["rendered_markdown"] = render_note_markdown(note.result, note.template_snapshot)
        data["rendered_text"] = render_note_text(note.result, note.template_snapshot)
    return data


def create_app(settings: Settings | None = None) -> APIGatewayHttpResolver:
    cfg = settings or Settings.from_env()
    cors = CORSConfig(
        allow_origin=cfg.cors_allow_origin,
        allow_headers=["Content-Type", "Authorization"],
        max_age=300,
    )
    app = APIGatewayHttpResolver(cors=cors, enable_validation=False)

    def body_model(model: type[M]) -> M:
        try:
            raw = app.current_event.body
            data = json.loads(raw) if raw else {}
        except ValueError as exc:
            raise validation_error("Request body is not valid JSON") from exc
        try:
            return model.model_validate(data)
        except ValidationError as exc:
            raise _pydantic_error(exc) from exc

    def clinic() -> str:
        return get_container().settings.default_clinic_id

    # -- error handlers ----------------------------------------------------------------

    @app.exception_handler(AppError)  # type: ignore[untyped-decorator]
    def _app_error(exc: AppError) -> Response[str]:
        return _json(exc.status, exc.body())

    @app.exception_handler(Exception)  # type: ignore[untyped-decorator]
    def _unexpected(exc: Exception) -> Response[str]:
        logger.error("unhandled_exception", extra={"error": type(exc).__name__})
        return _error(500, "INTERNAL", "Internal server error")

    @app.not_found
    def _not_found(_exc: Exception) -> Response[str]:
        if app.current_event.http_method.upper() == "OPTIONS":
            return Response(status_code=204, body="")
        return _error(404, "NOT_FOUND", "Route not found")

    # -- routes ------------------------------------------------------------------------

    @app.get("/v1/health")
    def health() -> Response[str]:
        s = get_container().settings
        return _json(
            200,
            {
                "status": "ok",
                "llm_provider": s.llm_provider,
                "storage": s.storage_backend,
                "evals_allow_trigger": s.evals_allow_trigger,
            },
        )

    @app.get("/v1/templates")
    def list_templates() -> Response[str]:
        items = get_container().template_service.list(clinic())
        return _json(200, {"items": [t.model_dump(mode="json") for t in items]})

    @app.post("/v1/templates")
    def create_template() -> Response[str]:
        data = body_model(TemplateInput)
        tpl = get_container().template_service.create(clinic(), data)
        return _json(201, tpl.model_dump(mode="json"))

    @app.get("/v1/templates/<template_id>")
    def get_template(template_id: str) -> Response[str]:
        return _json(
            200, get_container().template_service.get(clinic(), template_id).model_dump(mode="json")
        )

    @app.put("/v1/templates/<template_id>")
    def update_template(template_id: str) -> Response[str]:
        data = body_model(TemplateInput)
        tpl = get_container().template_service.update(clinic(), template_id, data)
        return _json(200, tpl.model_dump(mode="json"))

    @app.delete("/v1/templates/<template_id>")
    def delete_template(template_id: str) -> Response[str]:
        get_container().template_service.delete(clinic(), template_id)
        return _empty()

    @app.post("/v1/templates/<template_id>/duplicate")
    def duplicate_template(template_id: str) -> Response[str]:
        data = body_model(DuplicateRequest)
        tpl = get_container().template_service.duplicate(clinic(), template_id, data.name)
        return _json(201, tpl.model_dump(mode="json"))

    @app.post("/v1/notes")
    def create_note() -> Response[str]:
        req = body_model(CreateNoteRequest)
        note = get_container().note_service.create(clinic(), req)
        return _json(202, _note_json(note))

    @app.get("/v1/notes")
    def list_notes() -> Response[str]:
        raw = app.current_event.get_query_string_value("limit", "50") or "50"
        try:
            limit = int(raw)
        except ValueError as exc:
            raise validation_error("limit must be an integer") from exc
        limit = max(1, min(limit, 200))
        items = get_container().note_service.list(clinic(), limit)
        return _json(200, {"items": [i.model_dump(mode="json") for i in items]})

    @app.get("/v1/notes/<note_id>")
    def get_note(note_id: str) -> Response[str]:
        note = get_container().note_service.get(clinic(), note_id)
        return _json(200, _note_json(note, rendered=True))

    @app.patch("/v1/notes/<note_id>")
    def update_note(note_id: str) -> Response[str]:
        req = body_model(UpdateNoteRequest)
        note = get_container().note_service.update_result(clinic(), note_id, req.result)
        return _json(200, _note_json(note, rendered=True))

    @app.post("/v1/notes/<note_id>/regenerate")
    def regenerate_note(note_id: str) -> Response[str]:
        req = body_model(RegenerateRequest)
        note = get_container().note_service.regenerate(clinic(), note_id, req.template_id)
        return _json(202, _note_json(note))

    @app.delete("/v1/notes/<note_id>")
    def delete_note(note_id: str) -> Response[str]:
        get_container().note_service.delete(clinic(), note_id)
        return _empty()

    app.include_router(evals_router)
    return app


app = create_app()


@logger.inject_lambda_context(clear_state=True)
@metrics.log_metrics
def lambda_handler(event: dict[str, Any], context: LambdaContext) -> dict[str, Any]:
    return app.resolve(event, context)
