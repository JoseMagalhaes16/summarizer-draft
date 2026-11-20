"""Template management (built-ins merged at read time, read-only)."""

from __future__ import annotations

import uuid

from vetscribe.domain.builtin_templates import get_builtin, list_builtins
from vetscribe.domain.models import Template, TemplateInput, utc_now_iso
from vetscribe.errors import not_found, read_only
from vetscribe.repositories.base import TemplateRepository


class TemplateService:
    def __init__(self, repo: TemplateRepository) -> None:
        self._repo = repo

    def list(self, clinic_id: str) -> list[Template]:
        custom = sorted(
            self._repo.list_templates(clinic_id), key=lambda t: t.updated_at, reverse=True
        )
        return [*list_builtins(), *custom]

    def find(self, clinic_id: str, template_id: str) -> Template | None:
        return get_builtin(template_id) or self._repo.get_template(clinic_id, template_id)

    def get(self, clinic_id: str, template_id: str) -> Template:
        tpl = self.find(clinic_id, template_id)
        if tpl is None:
            raise not_found("Template")
        return tpl

    def create(self, clinic_id: str, data: TemplateInput) -> Template:
        now = utc_now_iso()
        tpl = Template(
            id=str(uuid.uuid4()),
            is_builtin=False,
            version=1,
            created_at=now,
            updated_at=now,
            **dict(data),
        )
        self._repo.put_template(clinic_id, tpl)
        return tpl

    def update(self, clinic_id: str, template_id: str, data: TemplateInput) -> Template:
        if get_builtin(template_id):
            raise read_only()
        existing = self._repo.get_template(clinic_id, template_id)
        if existing is None:
            raise not_found("Template")
        tpl = Template(
            id=existing.id,
            is_builtin=False,
            version=existing.version + 1,
            created_at=existing.created_at,
            updated_at=utc_now_iso(),
            **dict(data),
        )
        self._repo.put_template(clinic_id, tpl)
        return tpl

    def delete(self, clinic_id: str, template_id: str) -> None:
        if get_builtin(template_id):
            raise read_only()
        if not self._repo.delete_template(clinic_id, template_id):
            raise not_found("Template")

    def duplicate(self, clinic_id: str, template_id: str, name: str | None = None) -> Template:
        src = self.get(clinic_id, template_id)
        new_name = (name or f"{src.name} (copy)")[:120]
        payload = TemplateInput.model_validate(
            {**src.model_dump(include=set(TemplateInput.model_fields)), "name": new_name}
        )
        return self.create(clinic_id, payload)
