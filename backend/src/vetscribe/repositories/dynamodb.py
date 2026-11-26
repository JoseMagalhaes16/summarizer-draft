"""DynamoDB single-table repository.

PK = CLINIC#{clinic_id}; SK = TEMPLATE#{id} | NOTE#{ulid} | NOTETX#{ulid}; attribute ``entity``;
the full JSON document lives in ``data`` (a JSON string, which avoids float/Decimal round-trip
problems).

The transcript is stored in its own item (``NOTETX#`` + ulid, attribute ``transcript``) so a note
item stays small; the ``NOTETX#`` prefix deliberately does not match ``begins_with(SK, "NOTE#")``.
Summary fields and ``generation_id`` are duplicated as top-level attributes on the note item: the
list query projects only the former, and worker writes are conditioned on the latter.
"""

from __future__ import annotations

import json
from typing import Any

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from vetscribe.domain.models import Note, NoteSummary, Patient, Template
from vetscribe.repositories.base import ensure_fits


def _pk(clinic_id: str) -> str:
    return f"CLINIC#{clinic_id}"


class DynamoRepository:
    backend_name = "dynamodb"

    def __init__(self, table: Any) -> None:
        self._table = table

    def _query(self, clinic_id: str, prefix: str) -> list[str]:
        items: list[str] = []
        kwargs: dict[str, Any] = {
            "KeyConditionExpression": Key("PK").eq(_pk(clinic_id)) & Key("SK").begins_with(prefix),
        }
        while True:
            resp = self._table.query(**kwargs)
            items.extend(i["data"] for i in resp.get("Items", []))
            last = resp.get("LastEvaluatedKey")
            if not last:
                return items
            kwargs["ExclusiveStartKey"] = last

    def _get(self, clinic_id: str, sk: str) -> str | None:
        resp = self._table.get_item(Key={"PK": _pk(clinic_id), "SK": sk}, ConsistentRead=True)
        item = resp.get("Item")
        return str(item["data"]) if item else None

    # -- templates ---------------------------------------------------------------------

    def get_template(self, clinic_id: str, template_id: str) -> Template | None:
        data = self._get(clinic_id, f"TEMPLATE#{template_id}")
        return Template.model_validate_json(data) if data else None

    def list_templates(self, clinic_id: str) -> list[Template]:
        rows = self._query(clinic_id, "TEMPLATE#")
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
        if not data:
            return None
        resp = self._table.get_item(
            Key={"PK": _pk(clinic_id), "SK": f"NOTETX#{note_id}"}, ConsistentRead=True
        )
        doc = json.loads(data)
        doc["transcript"] = str(resp.get("Item", {}).get("transcript", ""))
        return Note.model_validate(doc)

    @staticmethod
    def _note_item(clinic_id: str, note: Note) -> dict[str, Any]:
        item: dict[str, Any] = {
            "PK": _pk(clinic_id),
            "SK": f"NOTE#{note.id}",
            "entity": "note",
            "data": note.model_dump_json(exclude={"transcript"}),
            "template_id": note.template_id,
            "template_name": note.template_name,
            "patient": note.patient.model_dump(),
            "status": note.status,
            "source": note.source,
            "created_at": note.created_at,
            "updated_at": note.updated_at,
        }
        if note.generation_id is not None:
            item["generation_id"] = note.generation_id
        if note.result and note.result.visit_summary:
            item["visit_summary"] = note.result.visit_summary
        ensure_fits(item)
        return item

    def put_note(self, clinic_id: str, note: Note) -> None:
        item = self._note_item(clinic_id, note)
        if note.transcript:  # manual notes may have none; get_note reads a missing item as ""
            tx_item = {
                "PK": _pk(clinic_id),
                "SK": f"NOTETX#{note.id}",
                "entity": "transcript",
                "transcript": note.transcript,
            }
            ensure_fits(tx_item)
            self._table.put_item(Item=tx_item)
        self._table.put_item(Item=item)

    def save_if_generation(
        self, clinic_id: str, note: Note, expected_generation_id: str | None
    ) -> bool:
        item = self._note_item(clinic_id, note)
        if expected_generation_id is None:
            cond = "attribute_exists(PK) AND attribute_not_exists(generation_id)"
            values: dict[str, Any] = {}
        else:
            cond = "generation_id = :g"
            values = {":g": expected_generation_id}
        kwargs: dict[str, Any] = {"Item": item, "ConditionExpression": cond}
        if values:
            kwargs["ExpressionAttributeValues"] = values
        try:
            self._table.put_item(**kwargs)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                return False
            raise
        return True

    def delete_note(self, clinic_id: str, note_id: str) -> bool:
        resp = self._table.delete_item(
            Key={"PK": _pk(clinic_id), "SK": f"NOTE#{note_id}"}, ReturnValues="ALL_OLD"
        )
        self._table.delete_item(Key={"PK": _pk(clinic_id), "SK": f"NOTETX#{note_id}"})
        return bool(resp.get("Attributes"))

    def list_note_summaries(self, clinic_id: str, limit: int = 50) -> list[NoteSummary]:
        kwargs: dict[str, Any] = {
            "KeyConditionExpression": Key("PK").eq(_pk(clinic_id)) & Key("SK").begins_with("NOTE#"),
            "ScanIndexForward": False,
            "Limit": limit,
            "ProjectionExpression": (
                "SK, template_id, template_name, #p, #s, #src, visit_summary, "
                "created_at, updated_at"
            ),
            "ExpressionAttributeNames": {"#p": "patient", "#s": "status", "#src": "source"},
        }
        out: list[NoteSummary] = []
        while True:
            resp = self._table.query(**kwargs)
            for i in resp.get("Items", []):
                out.append(
                    NoteSummary(
                        id=str(i["SK"]).removeprefix("NOTE#"),
                        template_id=i["template_id"],
                        template_name=i["template_name"],
                        patient=Patient.model_validate(i.get("patient") or {}),
                        status=i["status"],
                        source=i.get("source") or "ai",
                        visit_summary=i.get("visit_summary") or None,
                        created_at=i["created_at"],
                        updated_at=i["updated_at"],
                    )
                )
            last = resp.get("LastEvaluatedKey")
            if len(out) >= limit or not last:
                return out[:limit]
            kwargs["ExclusiveStartKey"] = last
