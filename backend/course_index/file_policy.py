from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Literal

from backend.config import DEFAULT_MAX_FILE_BYTES


FilePolicyViolation = Literal[
    "too_large",
    "unsupported_file_type",
]

DEFAULT_ALLOWED_CONTENT_TYPES = frozenset(
    {
        "application/json",
        "application/msword",
        "application/pdf",
        "application/rtf",
        "application/vnd.ms-excel",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/csv",
        "text/html",
        "text/markdown",
        "text/plain",
    }
)

DEFAULT_ALLOWED_FILE_EXTENSIONS = frozenset(
    {
        ".csv",
        ".doc",
        ".docx",
        ".html",
        ".htm",
        ".json",
        ".md",
        ".pdf",
        ".ppt",
        ".pptx",
        ".rtf",
        ".txt",
        ".xls",
        ".xlsx",
    }
)

DEFAULT_FILE_POLICY_MATERIAL_KINDS = frozenset({"attachment", "file", "slide"})


@dataclass(frozen=True)
class FilePolicyDecision:
    allowed: bool
    reason: FilePolicyViolation | None = None
    message: str | None = None


def evaluate_file_policy(
    *,
    size: int | None,
    content_type: str | None = None,
    file_name: str | None = None,
    max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
    allowed_content_types: frozenset[str] = DEFAULT_ALLOWED_CONTENT_TYPES,
    allowed_file_extensions: frozenset[str] = DEFAULT_ALLOWED_FILE_EXTENSIONS,
) -> FilePolicyDecision:
    if size is not None and size > max_file_bytes:
        return FilePolicyDecision(
            allowed=False,
            reason="too_large",
            message=f"Material size exceeds the {max_file_bytes} byte limit.",
        )

    if not _has_supported_type(
        content_type=content_type,
        file_name=file_name,
        allowed_content_types=allowed_content_types,
        allowed_file_extensions=allowed_file_extensions,
    ):
        return FilePolicyDecision(
            allowed=False,
            reason="unsupported_file_type",
            message=(
                "Material content type or file extension is not supported for "
                "indexing."
            ),
        )

    return FilePolicyDecision(allowed=True)


def should_apply_file_policy(
    *,
    kind: str,
    size: int | None = None,
    content_type: str | None = None,
    file_name: str | None = None,
    file_policy_material_kinds: frozenset[str] = DEFAULT_FILE_POLICY_MATERIAL_KINDS,
) -> bool:
    normalized_kind = kind.strip().lower()
    if normalized_kind in file_policy_material_kinds:
        return True

    return False


def _has_supported_type(
    *,
    content_type: str | None,
    file_name: str | None,
    allowed_content_types: frozenset[str],
    allowed_file_extensions: frozenset[str],
) -> bool:
    normalized_content_type = _normalize_content_type(content_type)
    if normalized_content_type in allowed_content_types:
        return True

    extension = _file_extension(file_name)
    if extension in allowed_file_extensions:
        return True

    return False


def _normalize_content_type(content_type: str | None) -> str | None:
    if content_type is None:
        return None

    normalized = content_type.split(";", 1)[0].strip().lower()
    return normalized or None


def _file_extension(file_name: str | None) -> str | None:
    if file_name is None:
        return None

    suffix = PurePosixPath(file_name.strip()).suffix.lower()
    return suffix or None
