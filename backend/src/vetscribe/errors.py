"""Application error types."""

from __future__ import annotations

from typing import Any

from vetscribe.domain.models import ErrorCode


class AppError(Exception):
    """An error that maps to an HTTP error response."""

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: list[Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details

    def body(self) -> dict[str, Any]:
        err: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details:
            err["details"] = self.details
        return {"error": err}


class PayloadTooLargeError(AppError):
    """A stored note would exceed the item-size budget (maps to HTTP 413)."""

    def __init__(self, message: str = "The note is too large to store") -> None:
        super().__init__(413, "PAYLOAD_TOO_LARGE", message)


def not_found(what: str) -> AppError:
    return AppError(404, "NOT_FOUND", f"{what} not found")


def read_only(what: str = "Built-in templates") -> AppError:
    return AppError(403, "READ_ONLY", f"{what} are read-only; duplicate to customise")


def validation_error(message: str, details: list[Any] | None = None) -> AppError:
    return AppError(400, "VALIDATION_ERROR", message, details)


class GenerationError(Exception):
    """Raised by generators / post-processing; stored on the note as `error`."""

    def __init__(self, code: ErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: ErrorCode = code
        self.message = message
