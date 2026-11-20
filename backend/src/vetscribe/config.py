"""Settings loaded from environment variables (single source of configuration)."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, replace
from typing import Any, Literal

# Placeholder: confirm the exact model / inference-profile ID in the Bedrock console (ADR-0003).
DEFAULT_BEDROCK_MODEL_ID = "us.anthropic.claude-opus-5-5"

StructuredMode = Literal["output_config", "tool"]


def _int(env: Mapping[str, str], key: str, default: int) -> int:
    raw = env.get(key, "").strip()
    return int(raw) if raw else default


def _float(env: Mapping[str, str], key: str, default: float) -> float:
    raw = env.get(key, "").strip()
    return float(raw) if raw else default


def _choice(env: Mapping[str, str], key: str, default: str, allowed: tuple[str, ...]) -> str:
    value = env.get(key, "").strip().lower() or default
    if value not in allowed:
        raise ValueError(f"{key} must be one of {allowed}, got {value!r}")
    return value


@dataclass(frozen=True)
class Settings:
    app_env: str = "local"
    llm_provider: str = "mock"
    storage_backend: str = "memory"
    local_data_file: str = ""
    table_name: str = ""
    job_dispatcher: str = "inline"
    worker_function_name: str = ""
    aws_region: str = "us-east-1"
    bedrock_model_id: str = DEFAULT_BEDROCK_MODEL_ID
    bedrock_structured_mode: StructuredMode = "output_config"
    bedrock_effort: str = "medium"
    bedrock_max_tokens: int = 16000
    bedrock_read_timeout_s: int = 300
    mock_latency_seconds: float = 2.5
    max_transcript_chars: int = 200000
    default_clinic_id: str = "default"
    cors_allow_origin: str = "*"
    log_level: str = "INFO"

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Settings:
        e = os.environ if env is None else env
        mode = _choice(e, "BEDROCK_STRUCTURED_MODE", "output_config", ("output_config", "tool"))
        return cls(
            app_env=_choice(e, "APP_ENV", "local", ("local", "aws")),
            llm_provider=_choice(e, "LLM_PROVIDER", "mock", ("mock", "bedrock")),
            storage_backend=_choice(e, "STORAGE_BACKEND", "memory", ("memory", "dynamodb")),
            local_data_file=e.get("LOCAL_DATA_FILE", ""),
            table_name=e.get("TABLE_NAME", ""),
            job_dispatcher=_choice(e, "JOB_DISPATCHER", "inline", ("inline", "lambda")),
            worker_function_name=e.get("WORKER_FUNCTION_NAME", ""),
            aws_region=e.get("AWS_REGION", "").strip() or "us-east-1",
            bedrock_model_id=e.get("BEDROCK_MODEL_ID", "").strip() or DEFAULT_BEDROCK_MODEL_ID,
            bedrock_structured_mode="tool" if mode == "tool" else "output_config",
            bedrock_effort=_choice(e, "BEDROCK_EFFORT", "medium", ("low", "medium", "high")),
            bedrock_max_tokens=_int(e, "BEDROCK_MAX_TOKENS", 16000),
            bedrock_read_timeout_s=_int(e, "BEDROCK_READ_TIMEOUT_S", 300),
            mock_latency_seconds=_float(e, "MOCK_LATENCY_SECONDS", 2.5),
            max_transcript_chars=_int(e, "MAX_TRANSCRIPT_CHARS", 200000),
            default_clinic_id=e.get("DEFAULT_CLINIC_ID", "").strip() or "default",
            cors_allow_origin=e.get("CORS_ALLOW_ORIGIN", "").strip() or "*",
            log_level=e.get("LOG_LEVEL", "").strip().upper() or "INFO",
        )

    def with_overrides(self, **changes: Any) -> Settings:
        return replace(self, **changes)
