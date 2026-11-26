"""Shared Powertools logger / metrics / tracer.

Never log transcript or note content here or anywhere else: only ids, sizes, timings and
token counts.
"""

from __future__ import annotations

import os

os.environ.setdefault("POWERTOOLS_METRICS_NAMESPACE", "VetScribe")
os.environ.setdefault("POWERTOOLS_SERVICE_NAME", "vetscribe")

from aws_lambda_powertools import Logger, Metrics

logger = Logger(service="vetscribe", level=os.environ.get("LOG_LEVEL", "INFO").upper())
metrics = Metrics(namespace=os.environ["POWERTOOLS_METRICS_NAMESPACE"], service="vetscribe")
