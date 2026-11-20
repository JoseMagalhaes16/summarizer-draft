from __future__ import annotations

import json
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

os.environ.setdefault("POWERTOOLS_METRICS_DISABLED", "true")
os.environ.setdefault("POWERTOOLS_METRICS_NAMESPACE", "VetScribe")
os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("LOG_LEVEL", "WARNING")

import pytest

from vetscribe.config import Settings
from vetscribe.container import Container, set_container
from vetscribe.domain.builtin_templates import get_builtin
from vetscribe.domain.models import Template
from vetscribe.jobs.dispatcher import InlineThreadDispatcher

FIXTURES = Path(__file__).parent / "fixtures" / "transcripts"


def transcript(name: str) -> str:
    return (FIXTURES / f"{name}.txt").read_text(encoding="utf-8")


@pytest.fixture
def otitis() -> str:
    return transcript("canine_otitis")


@pytest.fixture
def settings() -> Settings:
    return Settings(mock_latency_seconds=0.0)


@pytest.fixture
def soap() -> Template:
    t = get_builtin("builtin-soap")
    assert t is not None
    return t


@pytest.fixture
def container(settings: Settings) -> Iterator[Container]:
    c = Container(settings)
    set_container(c)
    yield c
    disp = c.dispatcher
    if isinstance(disp, InlineThreadDispatcher):
        disp.join()
    set_container(None)


def make_event(
    method: str, path: str, body: Any = None, query: dict[str, str] | None = None
) -> dict[str, Any]:
    return {
        "version": "2.0",
        "routeKey": "$default",
        "rawPath": path,
        "rawQueryString": "&".join(f"{k}={v}" for k, v in (query or {}).items()),
        "headers": {"content-type": "application/json", "origin": "http://localhost:5173"},
        "queryStringParameters": query or None,
        "requestContext": {
            "accountId": "1",
            "apiId": "x",
            "domainName": "x",
            "http": {"method": method, "path": path, "protocol": "HTTP/1.1", "sourceIp": "1.1.1.1"},
            "requestId": "r",
            "stage": "$default",
            "time": "01/Jan/2025:00:00:00 +0000",
            "timeEpoch": 0,
        },
        "body": json.dumps(body) if body is not None and not isinstance(body, str) else body,
        "isBase64Encoded": False,
    }


@pytest.fixture(params=["memory", "dynamodb"])
def any_repo(request: pytest.FixtureRequest) -> Iterator[Any]:
    """The same repository contract against the memory and the (moto) DynamoDB backends."""
    import boto3
    from moto import mock_aws

    from vetscribe.repositories.dynamodb import DynamoRepository
    from vetscribe.repositories.memory import MemoryRepository

    if request.param == "memory":
        yield MemoryRepository()
        return
    with mock_aws():
        ddb = boto3.resource("dynamodb", region_name="us-east-1")
        table = ddb.create_table(
            TableName="t",
            KeySchema=[
                {"AttributeName": "PK", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            AttributeDefinitions=[
                {"AttributeName": "PK", "AttributeType": "S"},
                {"AttributeName": "SK", "AttributeType": "S"},
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        repo = DynamoRepository(ddb.Table("t"))
        repo.raw_table = table  # type: ignore[attr-defined]
        yield repo
