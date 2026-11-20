"""Job dispatchers: hand a note id to the generation worker."""

from __future__ import annotations

import json
import threading
from collections.abc import Callable
from typing import Any, Protocol

from vetscribe.observability import logger


class JobDispatcher(Protocol):
    def dispatch(self, note_id: str, clinic_id: str) -> None: ...


class LambdaAsyncDispatcher:
    """Invoke the worker Lambda asynchronously (InvocationType=Event)."""

    def __init__(self, function_name: str, client: Any) -> None:
        if not function_name:
            raise ValueError("WORKER_FUNCTION_NAME is required for the lambda dispatcher")
        self._function_name = function_name
        self._client = client

    def dispatch(self, note_id: str, clinic_id: str) -> None:
        self._client.invoke(
            FunctionName=self._function_name,
            InvocationType="Event",
            Payload=json.dumps({"note_id": note_id, "clinic_id": clinic_id}).encode(),
        )


class InlineThreadDispatcher:
    """Run the worker function in a daemon thread (local development / tests)."""

    def __init__(self, worker: Callable[[str, str], object]) -> None:
        self._worker = worker
        self.threads: list[threading.Thread] = []

    def _run(self, note_id: str, clinic_id: str) -> None:
        try:
            self._worker(note_id, clinic_id)
        except Exception as exc:
            logger.error(
                "inline_worker_failed", extra={"note_id": note_id, "error": type(exc).__name__}
            )

    def dispatch(self, note_id: str, clinic_id: str) -> None:
        t = threading.Thread(
            target=self._run, args=(note_id, clinic_id), name=f"worker-{note_id}", daemon=True
        )
        self.threads = [x for x in self.threads if x.is_alive()]
        self.threads.append(t)
        t.start()

    def join(self, timeout: float = 10.0) -> None:
        for t in list(self.threads):
            t.join(timeout)
