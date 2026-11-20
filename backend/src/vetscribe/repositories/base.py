"""Repository protocols. Built-in templates are NOT stored here (merged by the service)."""

from __future__ import annotations

from typing import Protocol

from vetscribe.domain.models import Note, Template


class TemplateRepository(Protocol):
    def get_template(self, clinic_id: str, template_id: str) -> Template | None: ...

    def list_templates(self, clinic_id: str) -> list[Template]: ...

    def put_template(self, clinic_id: str, template: Template) -> None: ...

    def delete_template(self, clinic_id: str, template_id: str) -> bool: ...


class NoteRepository(Protocol):
    def get_note(self, clinic_id: str, note_id: str) -> Note | None: ...

    def put_note(self, clinic_id: str, note: Note) -> None: ...

    def delete_note(self, clinic_id: str, note_id: str) -> bool: ...

    def list_notes(self, clinic_id: str, limit: int = 50) -> list[Note]:
        """Newest first."""
        ...


class Repository(TemplateRepository, NoteRepository, Protocol):
    @property
    def backend_name(self) -> str: ...
