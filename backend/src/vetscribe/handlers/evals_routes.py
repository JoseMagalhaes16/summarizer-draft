"""``/v1/evals/*`` routes, included into the API resolver (see ``handlers.api``)."""

from __future__ import annotations

import json

from aws_lambda_powertools.event_handler import Response
from aws_lambda_powertools.event_handler.api_gateway import Router
from pydantic import ValidationError

from vetscribe.container import get_container
from vetscribe.errors import validation_error
from vetscribe.evals.models import RunConfig
from vetscribe.handlers.common import json_response, pydantic_error

router = Router()  # type: ignore[no-untyped-call]


@router.get("/v1/evals/cases")
def list_cases() -> Response[str]:
    return json_response(200, {"items": get_container().eval_service.list_cases()})


@router.get("/v1/evals/cases/<case_id>")
def get_case(case_id: str) -> Response[str]:
    return json_response(200, get_container().eval_service.get_case(case_id))


@router.get("/v1/evals/runs")
def list_runs() -> Response[str]:
    return json_response(200, {"items": get_container().eval_service.list_runs()})


@router.post("/v1/evals/runs")
def start_run() -> Response[str]:
    try:
        raw = router.current_event.body
        data = json.loads(raw) if raw else {}
    except ValueError as exc:
        raise validation_error("Request body is not valid JSON") from exc
    try:
        config = RunConfig.model_validate(data)
    except ValidationError as exc:
        raise pydantic_error(exc) from exc
    return json_response(202, get_container().eval_service.start_run(config))


@router.get("/v1/evals/runs/<run_id>")
def get_run(run_id: str) -> Response[str]:
    return json_response(200, get_container().eval_service.get_run(run_id))


@router.get("/v1/evals/runs/<run_id>/results")
def get_results(run_id: str) -> Response[str]:
    include = router.current_event.get_query_string_value("include", "") or ""
    items = get_container().eval_service.results(run_id, include_raw="raw" in include.split(","))
    return json_response(200, {"items": items})


@router.get("/v1/evals/compare")
def compare() -> Response[str]:
    event = router.current_event
    base = event.get_query_string_value("base", "") or ""
    cand = event.get_query_string_value("candidate", "") or ""
    if not base or not cand:
        raise validation_error("Query parameters `base` and `candidate` are required")
    return json_response(200, get_container().eval_service.compare(base, cand))
