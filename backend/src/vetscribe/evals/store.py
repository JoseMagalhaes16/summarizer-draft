"""Eval result stores: ``FileEvalStore`` (local dir) and ``S3EvalStore`` (same layout in S3).

Layout: ``runs/<run_id>/{config.json, results.jsonl, errors.jsonl, summary.json}`` plus
``cases/<id>.json`` snapshots of the cases a run used (so a read-only API without the case
directory can still show transcripts).
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Protocol

import boto3
from botocore.exceptions import ClientError

from vetscribe.config import Settings
from vetscribe.evals.cases import BACKEND_DIR
from vetscribe.evals.models import EvalCase, RunConfig, RunSummary

DEFAULT_RESULTS_DIR = BACKEND_DIR / ".eval-runs"


def resolve_results_dir(value: str | None) -> Path:
    """Resolve ``EVAL_RESULTS_DIR``; relative paths are relative to the ``backend/`` directory."""
    if not value:
        return DEFAULT_RESULTS_DIR
    p = Path(value).expanduser()
    return p if p.is_absolute() else (BACKEND_DIR / p).resolve()


class EvalStore(Protocol):
    def create_run(self, summary: RunSummary) -> None: ...
    def write_summary(self, summary: RunSummary) -> None: ...
    def update_progress(self, run_id: str, done: int, total: int) -> None: ...
    def append_result(self, run_id: str, row: dict[str, Any]) -> None: ...
    def append_error(self, run_id: str, row: dict[str, Any]) -> None: ...
    def flush(self, run_id: str) -> None: ...
    def get_summary(self, run_id: str) -> dict[str, Any] | None: ...
    def list_summaries(self, limit: int = 100) -> list[dict[str, Any]]: ...
    def read_results(self, run_id: str) -> list[dict[str, Any]]: ...
    def read_errors(self, run_id: str) -> list[dict[str, Any]]: ...
    def save_cases(self, cases: list[EvalCase]) -> None: ...
    def load_cases(self) -> list[EvalCase]: ...


def _lines(text: str) -> list[dict[str, Any]]:
    return [json.loads(line) for line in text.splitlines() if line.strip()]


class FileEvalStore:
    def __init__(self, root: Path | str) -> None:
        self.root = Path(root)
        self._lock = threading.Lock()

    def _dir(self, run_id: str) -> Path:
        if not run_id or "/" in run_id or "\\" in run_id or run_id.startswith("."):
            raise ValueError("invalid run id")
        return self.root / "runs" / run_id

    @staticmethod
    def _atomic(path: Path, text: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)

    def create_run(self, summary: RunSummary) -> None:
        d = self._dir(summary.run_id)
        with self._lock:
            self._atomic(d / "config.json", summary.config.model_dump_json(indent=2))
            self._atomic(d / "results.jsonl", "")
            self._atomic(d / "errors.jsonl", "")
            self._atomic(d / "summary.json", summary.model_dump_json(indent=2))

    def write_summary(self, summary: RunSummary) -> None:
        with self._lock:
            self._atomic(
                self._dir(summary.run_id) / "summary.json", summary.model_dump_json(indent=2)
            )

    def update_progress(self, run_id: str, done: int, total: int) -> None:
        with self._lock:
            path = self._dir(run_id) / "summary.json"
            data = json.loads(path.read_text(encoding="utf-8"))
            data["progress"] = {"done": done, "total": total}
            self._atomic(path, json.dumps(data, indent=2))

    def _append(self, path: Path, row: dict[str, Any]) -> None:
        with self._lock, path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(row) + "\n")

    def append_result(self, run_id: str, row: dict[str, Any]) -> None:
        self._append(self._dir(run_id) / "results.jsonl", row)

    def append_error(self, run_id: str, row: dict[str, Any]) -> None:
        self._append(self._dir(run_id) / "errors.jsonl", row)

    def flush(self, run_id: str) -> None:
        return None

    def get_summary(self, run_id: str) -> dict[str, Any] | None:
        try:
            path = self._dir(run_id) / "summary.json"
        except ValueError:
            return None
        if not path.is_file():
            return None
        data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        return data

    def list_summaries(self, limit: int = 100) -> list[dict[str, Any]]:
        runs = self.root / "runs"
        if not runs.is_dir():
            return []
        out = []
        for d in sorted((p for p in runs.iterdir() if p.is_dir()), reverse=True)[:limit]:
            s = self.get_summary(d.name)
            if s:
                out.append(s)
        return sorted(out, key=lambda s: s["created_at"], reverse=True)

    def _read(self, run_id: str, name: str) -> list[dict[str, Any]]:
        path = self._dir(run_id) / name
        return _lines(path.read_text(encoding="utf-8")) if path.is_file() else []

    def read_results(self, run_id: str) -> list[dict[str, Any]]:
        return self._read(run_id, "results.jsonl")

    def read_errors(self, run_id: str) -> list[dict[str, Any]]:
        return self._read(run_id, "errors.jsonl")

    def save_cases(self, cases: list[EvalCase]) -> None:
        for case in cases:
            self._atomic(self.root / "cases" / f"{case.id}.json", case.model_dump_json(indent=2))

    def load_cases(self) -> list[EvalCase]:
        d = self.root / "cases"
        if not d.is_dir():
            return []
        return [
            EvalCase.model_validate_json(p.read_text(encoding="utf-8"))
            for p in sorted(d.glob("*.json"))
        ]


class S3EvalStore:
    """Same layout in S3. JSONL files are buffered per run and uploaded on ``flush`` (and every
    ``FLUSH_EVERY`` rows), because S3 objects cannot be appended to."""

    FLUSH_EVERY = 25

    def __init__(self, bucket: str, prefix: str = "evals/", client: Any | None = None) -> None:
        if not bucket:
            raise ValueError("EVAL_S3_BUCKET is required for the s3 eval store")
        self.bucket = bucket
        self.prefix = prefix if not prefix or prefix.endswith("/") else prefix + "/"
        self._s3 = client if client is not None else boto3.client("s3")
        self._lock = threading.Lock()
        self._buf: dict[tuple[str, str], list[str]] = {}

    def _key(self, run_id: str, name: str) -> str:
        if not run_id or "/" in run_id:
            raise ValueError("invalid run id")
        return f"{self.prefix}runs/{run_id}/{name}"

    def _put(self, key: str, text: str) -> None:
        self._s3.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=text.encode("utf-8"),
            ContentType="application/json",
            ServerSideEncryption="AES256",
        )

    def _get(self, key: str) -> str | None:
        try:
            obj = self._s3.get_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                return None
            raise
        return str(obj["Body"].read().decode("utf-8"))

    def create_run(self, summary: RunSummary) -> None:
        self._put(
            self._key(summary.run_id, "config.json"), summary.config.model_dump_json(indent=2)
        )
        self._put(self._key(summary.run_id, "summary.json"), summary.model_dump_json(indent=2))
        with self._lock:
            self._buf[(summary.run_id, "results.jsonl")] = []
            self._buf[(summary.run_id, "errors.jsonl")] = []

    def write_summary(self, summary: RunSummary) -> None:
        self._put(self._key(summary.run_id, "summary.json"), summary.model_dump_json(indent=2))

    def update_progress(self, run_id: str, done: int, total: int) -> None:
        data = self.get_summary(run_id)
        if data is None:
            return
        data["progress"] = {"done": done, "total": total}
        self._put(self._key(run_id, "summary.json"), json.dumps(data, indent=2))

    def _append(self, run_id: str, name: str, row: dict[str, Any]) -> None:
        with self._lock:
            buf = self._buf.setdefault((run_id, name), [])
            buf.append(json.dumps(row))
            flush = len(buf) % self.FLUSH_EVERY == 0
            text = "\n".join(buf) + "\n" if flush else ""
        if flush:
            self._put(self._key(run_id, name), text)

    def append_result(self, run_id: str, row: dict[str, Any]) -> None:
        self._append(run_id, "results.jsonl", row)

    def append_error(self, run_id: str, row: dict[str, Any]) -> None:
        self._append(run_id, "errors.jsonl", row)

    def flush(self, run_id: str) -> None:
        for name in ("results.jsonl", "errors.jsonl"):
            with self._lock:
                buf = list(self._buf.get((run_id, name), []))
            self._put(self._key(run_id, name), "\n".join(buf) + "\n" if buf else "")

    def get_summary(self, run_id: str) -> dict[str, Any] | None:
        try:
            text = self._get(self._key(run_id, "summary.json"))
        except ValueError:
            return None
        return json.loads(text) if text else None

    def list_summaries(self, limit: int = 100) -> list[dict[str, Any]]:
        prefixes: list[str] = []
        paginator = self._s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(
            Bucket=self.bucket, Prefix=f"{self.prefix}runs/", Delimiter="/"
        ):
            prefixes += [p["Prefix"] for p in page.get("CommonPrefixes", [])]
        out = []
        for p in sorted(prefixes, reverse=True)[:limit]:
            text = self._get(p + "summary.json")
            if text:
                out.append(json.loads(text))
        return sorted(out, key=lambda s: s["created_at"], reverse=True)

    def _read(self, run_id: str, name: str) -> list[dict[str, Any]]:
        text = self._get(self._key(run_id, name))
        return _lines(text) if text else []

    def read_results(self, run_id: str) -> list[dict[str, Any]]:
        return self._read(run_id, "results.jsonl")

    def read_errors(self, run_id: str) -> list[dict[str, Any]]:
        return self._read(run_id, "errors.jsonl")

    def save_cases(self, cases: list[EvalCase]) -> None:
        for case in cases:
            self._put(f"{self.prefix}cases/{case.id}.json", case.model_dump_json(indent=2))

    def load_cases(self) -> list[EvalCase]:
        out = []
        paginator = self._s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=f"{self.prefix}cases/"):
            for obj in page.get("Contents", []):
                text = self._get(obj["Key"])
                if text:
                    out.append(EvalCase.model_validate_json(text))
        return sorted(out, key=lambda c: c.id)


def make_store(settings: Settings, kind: str | None = None) -> EvalStore:
    kind = kind or settings.eval_store
    if kind == "s3":
        return S3EvalStore(settings.eval_s3_bucket, settings.eval_s3_prefix)
    return FileEvalStore(resolve_results_dir(settings.eval_results_dir))


__all__ = [
    "EvalStore",
    "FileEvalStore",
    "RunConfig",
    "S3EvalStore",
    "make_store",
    "resolve_results_dir",
]
