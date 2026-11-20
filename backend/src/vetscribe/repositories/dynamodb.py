"""DynamoDB single-table repository.

PK = CLINIC#{clinic_id}; SK = TEMPLATE#{id} | NOTE#{ulid}; attribute ``entity``; the full JSON
document lives in ``data`` (a JSON string, which avoids float/Decimal round-trip problems).
"""

from __future__ import annotations

from typing import Any

from boto3.dynamodb.conditions import Key

from vetscribe.domain.models import Note, Template


def _pk(clinic_id: str) -> str:
    return f"CLINIC#{clinic_id}"


class DynamoRepository:
    backend_name = "dynamodb"

    def __init__(self, table: Any) -> None:
        self._table = table

    def _query(
        self, clinic_id: str, prefix: str, *, newest_first: bool, limit: int | None
    ) -> list[str]:
        items: list[str] = []
        kwargs: dict[str, Any] = {
            "KeyConditionExpression": Key("PK").eq(_pk(clinic_id)) & Key("SK").begins_with(prefix),
            "ScanIndexForward": not newest_first,
        }
        if limit is not None:
            kwargs["Limit"] = limit
        while True:
            resp = self._table.query(**kwargs)
            items.extend(i["data"] for i in resp.get("Items", []))
            if limit is not None and len(items) >= limit:
                return items[:limit]
            last = resp.get("LastEvaluatedKey")
            if not last:
                return items
            kwargs["ExclusiveStartKey"] = last

    def _get(self, clinic_id: str, sk: str) -> str | None:
        resp = self._table.get_item(Key={"PK": _pk(clinic_id), "SK": sk})
        item = resp.get("Item")
        return str(item["data"]) if item else None

    # -- templates ---------------------------------------------------------------------

    def get_template(self, clinic_id: str, template_id: str) -> Template | None:
        data = self._get(clinic_id, f"TEMPLATE#{template_id}")
        return Template.model_validate_json(data) if data else None

    def list_templates(self, clinic_id: str) -> list[Template]:
        rows = self._query(clinic_id, "TEMPLATE#", newest_first=False, limit=None)
        return [Template.model_validate_json(r) for r in rows]

    def put_template(self, clinic_id: str, template: Template) -> None:
        self._table.put_item(
            Item={
                "PK": _pk(clinic_id),
                "SK": f"TEMPLATE#{template.id}",
                "entity": "template",
                "data": template.model_dump_json(),
            }
        )

    def delete_template(self, clinic_id: str, template_id: str) -> bool:
        resp = self._table.delete_item(
            Key={"PK": _pk(clinic_id), "SK": f"TEMPLATE#{template_id}"}, ReturnValues="ALL_OLD"
        )
        return bool(resp.get("Attributes"))

    # -- notes -------------------------------------------------------------------------

    def get_note(self, clinic_id: str, note_id: str) -> Note | None:
        data = self._get(clinic_id, f"NOTE#{note_id}")
        return Note.model_validate_json(data) if data else None

    def put_note(self, clinic_id: str, note: Note) -> None:
        self._table.put_item(
            Item={
                "PK": _pk(clinic_id),
                "SK": f"NOTE#{note.id}",
                "entity": "note",
                "data": note.model_dump_json(),
            }
        )

    def delete_note(self, clinic_id: str, note_id: str) -> bool:
        resp = self._table.delete_item(
            Key={"PK": _pk(clinic_id), "SK": f"NOTE#{note_id}"}, ReturnValues="ALL_OLD"
        )
        return bool(resp.get("Attributes"))

    def list_notes(self, clinic_id: str, limit: int = 50) -> list[Note]:
        rows = self._query(clinic_id, "NOTE#", newest_first=True, limit=limit)
        return [Note.model_validate_json(r) for r in rows]
