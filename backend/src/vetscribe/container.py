"""Lazy service container, built once per cold start from ``Settings``. Tests may override."""

from __future__ import annotations

import threading
from typing import Any

import boto3

from vetscribe.config import Settings
from vetscribe.jobs.dispatcher import InlineThreadDispatcher, JobDispatcher, LambdaAsyncDispatcher
from vetscribe.llm.base import NoteGenerator
from vetscribe.llm.mock import MockNoteGenerator
from vetscribe.repositories.base import Repository
from vetscribe.repositories.memory import MemoryRepository
from vetscribe.services.notes import NoteService
from vetscribe.services.templates import TemplateService


class Container:
    def __init__(
        self,
        settings: Settings,
        *,
        repository: Repository | None = None,
        generator: NoteGenerator | None = None,
        dispatcher: JobDispatcher | None = None,
    ) -> None:
        self.settings = settings
        self._lock = threading.RLock()
        self._repository = repository
        self._generator = generator
        self._dispatcher = dispatcher
        self._template_service: TemplateService | None = None
        self._note_service: NoteService | None = None

    @property
    def repository(self) -> Repository:
        with self._lock:
            if self._repository is None:
                s = self.settings
                if s.storage_backend == "dynamodb":
                    if not s.table_name:
                        raise ValueError("TABLE_NAME is required for the dynamodb backend")
                    from vetscribe.repositories.dynamodb import DynamoRepository

                    table = boto3.resource("dynamodb", region_name=s.aws_region).Table(s.table_name)
                    self._repository = DynamoRepository(table)
                else:
                    self._repository = MemoryRepository(s.local_data_file)
            return self._repository

    @property
    def generator(self) -> NoteGenerator:
        with self._lock:
            if self._generator is None:
                if self.settings.llm_provider == "bedrock":
                    from vetscribe.llm.bedrock import BedrockNoteGenerator

                    self._generator = BedrockNoteGenerator(self.settings)
                else:
                    self._generator = MockNoteGenerator(self.settings.mock_latency_seconds)
            return self._generator

    @property
    def dispatcher(self) -> JobDispatcher:
        with self._lock:
            if self._dispatcher is None:
                s = self.settings
                if s.job_dispatcher == "lambda":
                    client: Any = boto3.client("lambda", region_name=s.aws_region)
                    self._dispatcher = LambdaAsyncDispatcher(s.worker_function_name, client)
                else:
                    self._dispatcher = InlineThreadDispatcher(
                        lambda note_id, clinic_id, gen_id: self.note_service.process(
                            note_id, clinic_id, gen_id
                        )
                    )
            return self._dispatcher

    @property
    def template_service(self) -> TemplateService:
        with self._lock:
            if self._template_service is None:
                self._template_service = TemplateService(self.repository)
            return self._template_service

    @property
    def note_service(self) -> NoteService:
        with self._lock:
            if self._note_service is None:
                self._note_service = NoteService(
                    self.repository,
                    self.template_service,
                    self.dispatcher,
                    self.generator,
                    self.settings,
                )
            return self._note_service


_container: Container | None = None
_container_lock = threading.Lock()


def get_container() -> Container:
    global _container
    with _container_lock:
        if _container is None:
            _container = Container(Settings.from_env())
        return _container


def set_container(container: Container | None) -> None:
    """Override (or reset with ``None``) the process-wide container; used by tests."""
    global _container
    with _container_lock:
        _container = container
