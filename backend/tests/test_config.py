from __future__ import annotations

import pytest

from vetscribe.config import DEFAULT_BEDROCK_MODEL_ID, Settings


def test_defaults() -> None:
    s = Settings.from_env({})
    assert s.llm_provider == "mock" and s.storage_backend == "memory"
    assert s.job_dispatcher == "inline" and s.bedrock_model_id == DEFAULT_BEDROCK_MODEL_ID
    assert s.bedrock_structured_mode == "output_config" and s.bedrock_max_tokens == 16000


def test_overrides() -> None:
    s = Settings.from_env(
        {
            "LLM_PROVIDER": "bedrock",
            "BEDROCK_STRUCTURED_MODE": "tool",
            "MOCK_LATENCY_SECONDS": "0.5",
            "BEDROCK_MODEL_ID": "x",
            "LOG_LEVEL": "debug",
        }
    )
    assert s.llm_provider == "bedrock" and s.bedrock_structured_mode == "tool"
    assert s.mock_latency_seconds == 0.5 and s.bedrock_model_id == "x" and s.log_level == "DEBUG"
    assert s.with_overrides(table_name="t").table_name == "t"


def test_invalid_choice() -> None:
    with pytest.raises(ValueError):
        Settings.from_env({"LLM_PROVIDER": "openai"})


def test_timeouts_and_staleness() -> None:
    s = Settings.from_env({})
    assert s.bedrock_read_timeout_s == 240 and s.stale_generation_seconds == 1200
    s = Settings.from_env({"BEDROCK_READ_TIMEOUT_S": "100", "STALE_GENERATION_SECONDS": "60"})
    assert s.bedrock_read_timeout_s == 100 and s.stale_generation_seconds == 60
