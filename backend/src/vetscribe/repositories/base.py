"""Repository protocols. Built-in templates are NOT stored here (merged by the service)."""

from __future__ import annotations

import json
from typing import Any, Protocol

from vetscribe.domain.models import Note, NoteSummary, Template
from vetscribe.errors import PayloadTooLargeError

# DynamoDB's hard limit is 400 KB per item; stay well below it.
MAX_ITEM_BYTES = 380_000


def item_size_bytes(item: Any) -> int:
    """Approximate serialized size (UTF-8 JSON bytes) of a stored item."""
    return len(json.dumps(item, ensure_ascii=False, default=str).encode("utf-8"))


def ensure_fits(item: Any) -> None:
    if item_size_bytes(item) > MAX_ITEM_BYTES:
        raise PayloadTooLargeError()


class TemplateRepository(Protocol):
    def get_template(self, clinic_id: str, template_id: str) -> Template | None: ...

    def list_templates(self, clinic_id: str) -> list[Template]: ...

    def put_template(self, clinic_id: str, template: Template) -> None: ...

    def delete_template(self, clinic_id: str, template_id: str) -> bool: ...


class NoteRepository(Protocol):
    def get_note(self, clinic_id: str, note_id: str) -> Note | None:
        """Strongly consistent read; the transcript is reassembled onto the note."""
        ...

    def put_note(self, clinic_id: str, note: Note) -> None:
        """Unconditional write of the note and its transcript (create / regenerate).

        Raises ``PayloadTooLargeError`` when the item would exceed the size budget.
        """
        ...

    def save_if_generation(
        self, clinic_id: str, note: Note, expected_generation_id: str | None
    ) -> bool:
        """Atomically write ``note`` only if the stored note still has this generation id.

        Returns False (and writes nothing) when the note was deleted or regenerated meanwhile.
        The transcript is not rewritten. Raises ``PayloadTooLargeError`` when too large.
        """
        ...

    def delete_note(self, clinic_id: str, note_id: str) -> bool: ...

    def list_note_summaries(self, clinic_id: str, limit: int = 50) -> list[NoteSummary]:
        """Newest first; never loads transcripts or results."""
        ...


class Repository(TemplateRepository, NoteRepository, Protocol):
    @property
    def backend_name(self) -> str: ...
