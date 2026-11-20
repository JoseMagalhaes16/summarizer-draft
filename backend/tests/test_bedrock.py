from __future__ import annotations

import io
import json
from typing import Any

import boto3
import pytest
from botocore.config import Config
from botocore.response import StreamingBody
from botocore.stub import ANY, Stubber

from vetscribe.config import Settings
from vetscribe.domain.models import Patient, Template
from vetscribe.errors import GenerationError
from vetscribe.llm.bedrock import BedrockNoteGenerator, make_client


def _resp(payload: dict[str, Any]) -> dict[str, Any]:
    raw = json.dumps(payload).encode()
    return {"body": StreamingBody(io.BytesIO(raw), len(raw)), "contentType": "application/json"}


def _resp_raw(raw: bytes) -> dict[str, Any]:
    return {"body": StreamingBody(io.BytesIO(raw), len(raw)), "contentType": "application/json"}


def _setup(mode: str) -> tuple[BedrockNoteGenerator, Stubber, list[dict[str, Any]]]:
    settings = Settings(bedrock_structured_mode=mode, bedrock_model_id="test-model")  # type: ignore[arg-type]
    client = boto3.client("bedrock-runtime", region_name="us-east-1", config=Config())
    bodies: list[dict[str, Any]] = []

    def capture(params: dict[str, Any], **_: Any) -> None:
        bodies.append(json.loads(params["body"]))

    client.meta.events.register(
        "before-parameter-build.bedrock-runtime.InvokeModel", lambda params, **k: capture(params)
    )
    return BedrockNoteGenerator(settings, client), Stubber(client), bodies


RAW = {
    "visit_summary": "s",
    "sections": {},
    "action_items": [],
    "review_flags": [],
}
USAGE = {"input_tokens": 11, "output_tokens": 7}


def _stub(stub: Stubber, payload: dict[str, Any]) -> None:
    stub.add_response(
        "invoke_model",
        _resp(payload),
        {
            "modelId": "test-model",
            "body": ANY,
            "contentType": "application/json",
            "accept": "application/json",
        },
    )


def test_output_config_mode_success(soap: Template) -> None:
    gen, stub, bodies = _setup("output_config")
    _stub(
        stub,
        {
            "stop_reason": "end_turn",
            "usage": USAGE,
            "content": [{"type": "text", "text": json.dumps(RAW)}],
        },
    )
    with stub:
        result = gen.generate(soap, "t", Patient())
    assert result.raw == RAW
    assert result.model_info.provider == "bedrock" and result.model_info.input_tokens == 11
    body = bodies[0]
    assert body["anthropic_version"] == "bedrock-2023-05-31"
    assert "temperature" not in body and "top_p" not in body and "top_k" not in body
    assert "thinking" not in body and "tools" not in body and "tool_choice" not in body
    fmt = body["output_config"]["format"]
    assert fmt["type"] == "json_schema" and fmt["schema"]["additionalProperties"] is False
    assert body["output_config"]["effort"] == "medium"
    assert body["system"][0]["type"] == "text" and body["max_tokens"] == 16000


def test_tool_mode_success(soap: Template) -> None:
    gen, stub, bodies = _setup("tool")
    _stub(
        stub,
        {
            "stop_reason": "tool_use",
            "usage": USAGE,
            "content": [
                {"type": "text", "text": "ok"},
                {"type": "tool_use", "id": "1", "name": "record_clinical_note", "input": RAW},
            ],
        },
    )
    with stub:
        result = gen.generate(soap, "t", Patient())
    assert result.raw == RAW
    body = bodies[0]
    assert body["tool_choice"] == {"type": "auto"}
    assert body["tools"][0]["strict"] is True and body["tools"][0]["name"] == "record_clinical_note"
    assert "format" not in body["output_config"] and "temperature" not in body


def test_tool_mode_no_tool_retries_then_fails(soap: Template) -> None:
    gen, stub, bodies = _setup("tool")
    for _ in range(2):
        _stub(
            stub,
            {
                "stop_reason": "end_turn",
                "usage": USAGE,
                "content": [{"type": "text", "text": "hi"}],
            },
        )
    with stub, pytest.raises(GenerationError) as ei:
        gen.generate(soap, "t", Patient())
    assert ei.value.code == "INVALID_MODEL_OUTPUT" and len(bodies) == 2


def test_tool_mode_retry_succeeds(soap: Template) -> None:
    gen, stub, _ = _setup("tool")
    _stub(stub, {"stop_reason": "end_turn", "usage": USAGE, "content": []})
    _stub(
        stub,
        {
            "stop_reason": "tool_use",
            "usage": USAGE,
            "content": [
                {"type": "tool_use", "id": "1", "name": "record_clinical_note", "input": RAW}
            ],
        },
    )
    with stub:
        result = gen.generate(soap, "t", Patient())
    assert result.model_info.input_tokens == 22


@pytest.mark.parametrize(
    ("stop", "code"), [("refusal", "MODEL_REFUSAL"), ("max_tokens", "OUTPUT_TRUNCATED")]
)
def test_stop_reasons(soap: Template, stop: str, code: str) -> None:
    gen, stub, _ = _setup("output_config")
    _stub(stub, {"stop_reason": stop, "usage": USAGE, "content": [{"type": "text", "text": "{"}]})
    with stub, pytest.raises(GenerationError) as ei:
        gen.generate(soap, "t", Patient())
    assert ei.value.code == code


@pytest.mark.parametrize("text", ["not json", "[1]"])
def test_bad_json(soap: Template, text: str) -> None:
    gen, stub, _ = _setup("output_config")
    _stub(
        stub,
        {"stop_reason": "end_turn", "usage": USAGE, "content": [{"type": "text", "text": text}]},
    )
    with stub, pytest.raises(GenerationError) as ei:
        gen.generate(soap, "t", Patient())
    assert ei.value.code == "INVALID_MODEL_OUTPUT"


def test_client_error(soap: Template) -> None:
    gen, stub, _ = _setup("output_config")
    stub.add_client_error(
        "invoke_model", service_error_code="ThrottlingException", http_status_code=429
    )
    with stub, pytest.raises(GenerationError) as ei:
        gen.generate(soap, "t", Patient())
    assert ei.value.code == "LLM_ERROR" and "ThrottlingException" in ei.value.message


def test_non_json_body_and_non_dict(soap: Template) -> None:
    gen, stub, _ = _setup("output_config")
    raw = b"<html>"
    stub.add_response("invoke_model", _resp_raw(raw))
    raw2 = b"[]"
    stub.add_response("invoke_model", _resp_raw(raw2))
    with stub:
        for _ in range(2):
            with pytest.raises(GenerationError) as ei:
                gen.generate(soap, "t", Patient())
            assert ei.value.code == "LLM_ERROR"


def test_make_client_config() -> None:
    client = make_client(Settings(bedrock_read_timeout_s=123))
    cfg = client.meta.config
    assert cfg.read_timeout == 123
    assert (
        cfg.retries["mode"] == "adaptive" and cfg.retries["total_max_attempts"] == 5
    )  # max_attempts=4 retries + 1
