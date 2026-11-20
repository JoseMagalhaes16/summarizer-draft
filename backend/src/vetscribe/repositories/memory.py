"""Thread-safe in-memory repository with optional JSON-file persistence."""

from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Any

from vetscribe.domain.models import Note, Template


class MemoryRepository:
    backend_name = "memory"

    def __init__(self, data_file: str = "") -> None:
        self._lock = threading.RLock()
        self._templates: dict[str, dict[str, dict[str, Any]]] = {}
        self._notes: dict[str, dict[str, dict[str, Any]]] = {}
        self._path = Path(data_file) if data_file else None
        if self._path and self._path.exists():
            self._load()

    # -- persistence -------------------------------------------------------------------

    def _load(self) -> None:
        assert self._path is not None
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        self._templates = data.get("templates", {})
        self._notes = data.get("notes", {})

    def _flush(self) -> None:
        if not self._path:
            return
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps({"templates": self._templates, "notes": self._notes})
        fd, tmp = tempfile.mkstemp(dir=self._path.parent, prefix=".vetscribe-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(payload)
            os.replace(tmp, self._path)
        except OSError:
            Path(tmp).unlink(missing_ok=True)
            raise

    # -- templates ---------------------------------------------------------------------

    def get_template(self, clinic_id: str, template_id: str) -> Template | None:
        with self._lock:
            raw = self._templates.get(clinic_id, {}).get(template_id)
            return Template.model_validate(raw) if raw else None

    def list_templates(self, clinic_id: str) -> list[Template]:
        with self._lock:
            return [Template.model_validate(r) for r in self._templates.get(clinic_id, {}).values()]

    def put_template(self, clinic_id: str, template: Template) -> None:
        with self._lock:
            self._templates.setdefault(clinic_id, {})[template.id] = template.model_dump(
                mode="json"
            )
            self._flush()

    def delete_template(self, clinic_id: str, template_id: str) -> bool:
        with self._lock:
            removed = self._templates.get(clinic_id, {}).pop(template_id, None) is not None
            if removed:
                self._flush()
            return removed

    # -- notes -------------------------------------------------------------------------

    def get_note(self, clinic_id: str, note_id: str) -> Note | None:
        with self._lock:
            raw = self._notes.get(clinic_id, {}).get(note_id)
            return Note.model_validate(raw) if raw else None

    def put_note(self, clinic_id: str, note: Note) -> None:
        with self._lock:
            self._notes.setdefault(clinic_id, {})[note.id] = note.model_dump(mode="json")
            self._flush()

    def delete_note(self, clinic_id: str, note_id: str) -> bool:
        with self._lock:
            removed = self._notes.get(clinic_id, {}).pop(note_id, None) is not None
            if removed:
                self._flush()
            return removed

    def list_notes(self, clinic_id: str, limit: int = 50) -> list[Note]:
        with self._lock:
            ids = sorted(self._notes.get(clinic_id, {}), reverse=True)[:limit]
            return [Note.model_validate(self._notes[clinic_id][i]) for i in ids]
