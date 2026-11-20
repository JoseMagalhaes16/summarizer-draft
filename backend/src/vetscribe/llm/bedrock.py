"""AWS-native Bedrock Runtime generator (boto3 ``invoke_model``, Anthropic Messages body)."""

from __future__ import annotations

import json
import time
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from vetscribe.config import Settings
from vetscribe.domain.models import ModelInfo, Patient, Template
from vetscribe.errors import GenerationError
from vetscribe.llm.base import GenerationResult
from vetscribe.observability import logger
from vetscribe.prompts.builder import (
    SYSTEM_PROMPT,
    TOOL_NAME,
    build_json_schema,
    build_user_prompt,
)

ANTHROPIC_VERSION = "bedrock-2023-05-31"
# Extra headroom (seconds) required on top of one read timeout before a second attempt starts.
RETRY_MARGIN_S = 30
_TOOL_DESCRIPTION = (
    "Record the finished structured clinical note for this consultation. "
    "Call exactly once with the complete note."
)


def make_client(settings: Settings) -> Any:
    cfg = Config(
        region_name=settings.aws_region,
        read_timeout=settings.bedrock_read_timeout_s,
        connect_timeout=10,
        retries={"mode": "adaptive", "total_max_attempts": 2},
    )
    return boto3.client("bedrock-runtime", config=cfg)


class BedrockNoteGenerator:
    def __init__(self, settings: Settings, client: Any | None = None) -> None:
        self._settings = settings
        self._client = client if client is not None else make_client(settings)

    # -- request -----------------------------------------------------------------------

    def build_request_body(
        self,
        template: Template,
        transcript: str,
        patient: Patient,
        clinician: str = "",
    ) -> dict[str, Any]:
        s = self._settings
        tool_mode = s.bedrock_structured_mode == "tool"
        schema = build_json_schema(template)
        body: dict[str, Any] = {
            "anthropic_version": ANTHROPIC_VERSION,
            "max_tokens": s.bedrock_max_tokens,
            "system": [{"type": "text", "text": SYSTEM_PROMPT}],
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": build_user_prompt(
                                template, transcript, patient, clinician, tool_mode=tool_mode
                            ),
                        }
                    ],
                }
            ],
        }
        if tool_mode:
            body["output_config"] = {"effort": s.bedrock_effort}
            body["tools"] = [
                {
                    "name": TOOL_NAME,
                    "description": _TOOL_DESCRIPTION,
                    "input_schema": schema,
                    "strict": True,
                }
            ]
            # Forced tool_choice (any/tool) is rejected by current Claude models: auto only.
            body["tool_choice"] = {"type": "auto"}
        else:
            body["output_config"] = {
                "effort": s.bedrock_effort,
                "format": {"type": "json_schema", "schema": schema},
            }
        return body

    # -- invocation --------------------------------------------------------------------

    def _invoke(self, body: dict[str, Any]) -> dict[str, Any]:
        try:
            resp = self._client.invoke_model(
                modelId=self._settings.bedrock_model_id,
                body=json.dumps(body),
                contentType="application/json",
                accept="application/json",
            )
            payload = json.loads(resp["body"].read())
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "Unknown")
            logger.warning("bedrock_client_error", extra={"error_code": code})
            raise GenerationError("LLM_ERROR", f"Bedrock request failed ({code}).") from exc
        except BotoCoreError as exc:
            logger.warning("bedrock_botocore_error", extra={"error_type": type(exc).__name__})
            raise GenerationError(
                "LLM_ERROR", "Bedrock request failed (network/SDK error)."
            ) from exc
        except ValueError as exc:
            raise GenerationError("LLM_ERROR", "Bedrock returned an unreadable response.") from exc
        if not isinstance(payload, dict):
            raise GenerationError("LLM_ERROR", "Bedrock returned an unexpected response.")
        return payload

    @staticmethod
    def _check_stop_reason(payload: dict[str, Any]) -> None:
        stop = payload.get("stop_reason")
        if stop == "refusal":
            raise GenerationError("MODEL_REFUSAL", "The model declined to process this request.")
        if stop == "max_tokens":
            raise GenerationError(
                "OUTPUT_TRUNCATED",
                "The note was cut off because the output limit was reached. "
                "Try a shorter transcript or a template with fewer sections.",
            )

    @staticmethod
    def _parse_text_json(payload: dict[str, Any]) -> dict[str, Any]:
        text = "".join(
            b.get("text", "") for b in payload.get("content", []) if b.get("type") == "text"
        ).strip()
        try:
            data = json.loads(text)
        except ValueError as exc:
            raise GenerationError(
                "INVALID_MODEL_OUTPUT", "Model output was not valid JSON."
            ) from exc
        if not isinstance(data, dict):
            raise GenerationError("INVALID_MODEL_OUTPUT", "Model output was not a JSON object.")
        return data

    @staticmethod
    def _find_tool_input(payload: dict[str, Any]) -> dict[str, Any] | None:
        for block in payload.get("content", []):
            if block.get("type") == "tool_use" and isinstance(block.get("input"), dict):
                return dict(block["input"])
        return None

    # -- public ------------------------------------------------------------------------

    def generate(
        self,
        template: Template,
        transcript: str,
        patient: Patient,
        clinician: str = "",
        deadline: float | None = None,
    ) -> GenerationResult:
        started = time.monotonic()
        body = self.build_request_body(template, transcript, patient, clinician)
        tool_mode = self._settings.bedrock_structured_mode == "tool"
        attempts = 2 if tool_mode else 1
        in_tok = out_tok = 0
        raw: dict[str, Any] | None = None

        for attempt in range(1, attempts + 1):
            if attempt > 1 and deadline is not None:
                budget = deadline - time.monotonic()
                if budget <= self._settings.bedrock_read_timeout_s + RETRY_MARGIN_S:
                    logger.warning("bedrock_retry_skipped_budget", extra={"budget_s": int(budget)})
                    break
            payload = self._invoke(body)
            usage = payload.get("usage") or {}
            in_tok += int(usage.get("input_tokens", 0))
            out_tok += int(usage.get("output_tokens", 0))
            self._check_stop_reason(payload)
            if tool_mode:
                raw = self._find_tool_input(payload)
                if raw is None:
                    logger.warning("bedrock_no_tool_use", extra={"attempt": attempt})
                    continue
            else:
                raw = self._parse_text_json(payload)
            break

        if raw is None:
            raise GenerationError(
                "INVALID_MODEL_OUTPUT", "The model did not return a structured note."
            )

        latency_ms = int((time.monotonic() - started) * 1000)
        logger.info(
            "bedrock_generation_done",
            extra={"input_tokens": in_tok, "output_tokens": out_tok, "latency_ms": latency_ms},
        )
        return GenerationResult(
            raw=raw,
            model_info=ModelInfo(
                provider="bedrock",
                model_id=self._settings.bedrock_model_id,
                input_tokens=in_tok,
                output_tokens=out_tok,
                latency_ms=latency_ms,
            ),
        )
