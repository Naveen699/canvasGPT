from __future__ import annotations

import base64
import re
import time
import uuid
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal
from urllib.error import URLError
from urllib.request import Request, urlopen

from backend.config import DEFAULT_MAX_FILE_BYTES
from backend.course_index.models import CourseIndexMaterial
from backend.openai_client import (
    FileBatch,
    FileContent,
    OpenAIClientProtocol,
    UploadedFile,
    VectorStoreFileAttachment,
)


MAX_VECTOR_STORE_BATCH_SIZE = 500
DEFAULT_SIGNED_FILE_TIMEOUT_SECONDS = 30
DEFAULT_BATCH_POLL_ATTEMPTS = 60
DEFAULT_BATCH_POLL_INTERVAL_SECONDS = 1.0

CourseIndexSyncStatus = Literal["ready", "partial", "failed"]
CourseIndexSyncErrorCode = Literal[
    "course_not_found",
    "consent_required",
    "vector_store_missing",
    "invalid_request",
]


class CourseIndexSyncError(RuntimeError):
    def __init__(self, code: CourseIndexSyncErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class CourseIndexSyncWarning:
    reason: str
    message: str
    material_key: str | None = None
    title: str | None = None


@dataclass(frozen=True)
class SignedCanvasFile:
    material_key: str
    file_name: str
    signed_url: str | None = None
    content_bytes_or_stream: FileContent | None = None
    content_type: str | None = None
    size: int | None = None
    title: str | None = None


@dataclass(frozen=True)
class CourseIndexSyncResult:
    course_index_id: str
    generation_id: str
    status: CourseIndexSyncStatus
    native_indexed_count: int = 0
    file_indexed_count: int = 0
    pending_file_count: int = 0
    skipped_count: int = 0
    failed_count: int = 0
    warnings: list[CourseIndexSyncWarning] = field(default_factory=list)


@dataclass(frozen=True)
class _Material:
    material_key: str
    kind: str
    title: str | None = None
    canvas_url: str | None = None
    canvas_updated_at: str | None = None
    content_hash: str | None = None
    size: int | None = None
    content_type: str | None = None
    file_name: str | None = None
    supported_for_indexing: bool = True
    raw: Any = None


@dataclass(frozen=True)
class _UploadedMaterial:
    material_key: str
    kind: str
    title: str | None
    uploaded_file: UploadedFile
    attachment: VectorStoreFileAttachment
    material: _Material | None = None
    signed_file: SignedCanvasFile | None = None


@dataclass(frozen=True)
class _AttachmentCounts:
    indexed: int = 0
    pending: int = 0
    failed: int = 0


class CourseIndexSyncService:
    def __init__(
        self,
        *,
        repository: Any,
        openai_client: OpenAIClientProtocol,
        now: Callable[[], datetime] | None = None,
        max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
        signed_file_timeout_seconds: int = DEFAULT_SIGNED_FILE_TIMEOUT_SECONDS,
        batch_poll_attempts: int = DEFAULT_BATCH_POLL_ATTEMPTS,
        batch_poll_interval_seconds: float = DEFAULT_BATCH_POLL_INTERVAL_SECONDS,
    ) -> None:
        self._repository = repository
        self._openai_client = openai_client
        self._now = now or (lambda: datetime.now(UTC))
        self._max_file_bytes = max_file_bytes
        self._signed_file_timeout_seconds = signed_file_timeout_seconds
        self._batch_poll_attempts = max(0, batch_poll_attempts)
        self._batch_poll_interval_seconds = max(0.0, batch_poll_interval_seconds)

    def sync(
        self,
        *,
        course_index_id: str,
        generation_id: str | None = None,
        materials: Sequence[CourseIndexMaterial | Mapping[str, Any] | Any] = (),
        signed_files: Sequence[SignedCanvasFile | Mapping[str, Any] | Any] = (),
    ) -> CourseIndexSyncResult:
        course_id = _required_text(course_index_id, "course_index_id")
        course = self._repository.get_course_by_id(course_id)
        if course is None:
            raise CourseIndexSyncError(
                "course_not_found",
                "Course index was not found.",
            )

        if not bool(course.get("consent_granted")):
            raise CourseIndexSyncError(
                "consent_required",
                "Course index consent is required before syncing materials.",
            )

        vector_store_id = _compact(course.get("vector_store_id"))
        if vector_store_id is None:
            raise CourseIndexSyncError(
                "vector_store_missing",
                "Course index vector store is required before syncing materials.",
            )

        sync_generation_id = _compact(generation_id) or _new_generation_id()
        sync_run = self._create_sync_run(
            course_id=course_id,
            generation_id=sync_generation_id,
        )
        self._set_active_generation(
            course_id=course_id,
            generation_id=sync_generation_id,
        )

        warnings: list[CourseIndexSyncWarning] = []
        skipped_count = 0
        failed_count = 0
        existing_materials_by_key = self._existing_materials_by_key(course_id=course_id)

        normalized_materials = [_coerce_material(material) for material in materials]
        native_uploads: list[_UploadedMaterial] = []
        for material in normalized_materials:
            if _is_canvas_file_material(material):
                continue

            if not material.supported_for_indexing:
                skipped_count += 1
                warnings.append(
                    CourseIndexSyncWarning(
                        material_key=material.material_key,
                        title=material.title,
                        reason="unsupported_material",
                        message="Material is not supported for indexing.",
                    )
                )
                self._mark_material(
                    course_id=course_id,
                    material=material,
                    generation_id=sync_generation_id,
                    status="skipped",
                    error_type="unsupported_material",
                    error_message="Material is not supported for indexing.",
                )
                continue

            try:
                native_uploads.append(
                    self._upload_native_material(
                        course_id=course_id,
                        generation_id=sync_generation_id,
                        material=material,
                        existing_material=existing_materials_by_key.get(
                            material.material_key
                        ),
                    )
                )
            except Exception:
                failed_count += 1
                warnings.append(
                    CourseIndexSyncWarning(
                        material_key=material.material_key,
                        title=material.title,
                        reason="native_upload_failed",
                        message="Native Canvas material upload failed.",
                    )
                )
                self._mark_material(
                    course_id=course_id,
                    material=material,
                    generation_id=sync_generation_id,
                    status="failed",
                    error_type="native_upload_failed",
                    error_message="Native Canvas material upload failed.",
                )

        file_uploads: list[_UploadedMaterial] = []
        for signed_file in map(_coerce_signed_file, signed_files):
            try:
                file_uploads.append(
                    self._upload_signed_file(
                        course_id=course_id,
                        generation_id=sync_generation_id,
                        signed_file=signed_file,
                        existing_material=existing_materials_by_key.get(
                            signed_file.material_key
                        ),
                    )
                )
            except Exception:
                failed_count += 1
                warnings.append(
                    CourseIndexSyncWarning(
                        material_key=signed_file.material_key,
                        title=signed_file.title,
                        reason="file_upload_failed",
                        message="Canvas file upload failed.",
                    )
                )
                self._mark_signed_file(
                    course_id=course_id,
                    signed_file=signed_file,
                    generation_id=sync_generation_id,
                    status="failed",
                    error_type="file_upload_failed",
                    error_message="Canvas file upload failed.",
                )

        native_counts = self._attach_uploaded_materials(
            course_id=course_id,
            generation_id=sync_generation_id,
            vector_store_id=vector_store_id,
            uploads=native_uploads,
            warnings=warnings,
        )
        file_counts = self._attach_uploaded_materials(
            course_id=course_id,
            generation_id=sync_generation_id,
            vector_store_id=vector_store_id,
            uploads=file_uploads,
            warnings=warnings,
        )
        failed_count += native_counts.failed + file_counts.failed

        pending_file_count = native_counts.pending + file_counts.pending
        status_value = _result_status(
            indexed_count=native_counts.indexed + file_counts.indexed,
            pending_count=pending_file_count,
            skipped_count=skipped_count,
            failed_count=failed_count,
        )
        completed_at = self._timestamp() if status_value != "failed" else None
        self._mark_course_sync_status(
            course_id=course_id,
            sync_status=status_value,
            last_synced_at=completed_at,
        )
        self._complete_sync_run(
            sync_run_id=sync_run["id"],
            status=status_value,
            indexed_count=native_counts.indexed + file_counts.indexed,
            pending_count=pending_file_count,
            skipped_count=skipped_count,
            failed_count=failed_count,
            completed_at=completed_at,
        )

        return CourseIndexSyncResult(
            course_index_id=course_id,
            generation_id=sync_generation_id,
            status=status_value,
            native_indexed_count=native_counts.indexed,
            file_indexed_count=file_counts.indexed,
            pending_file_count=pending_file_count,
            skipped_count=skipped_count,
            failed_count=failed_count,
            warnings=warnings,
        )

    def _upload_native_material(
        self,
        *,
        course_id: str,
        generation_id: str,
        material: _Material,
        existing_material: Mapping[str, Any] | None = None,
    ) -> _UploadedMaterial:
        existing_openai_file_id = _compact(
            existing_material.get("openai_file_id") if existing_material else None
        )
        if existing_openai_file_id is not None:
            uploaded_file = UploadedFile(
                id=existing_openai_file_id,
                filename=_synthetic_markdown_file_name(material),
            )
            self._mark_material(
                course_id=course_id,
                material=material,
                generation_id=generation_id,
                status="pending",
                openai_file_id=uploaded_file.id,
            )
            return _UploadedMaterial(
                material_key=material.material_key,
                kind=material.kind,
                title=material.title,
                uploaded_file=uploaded_file,
                attachment=_attachment_for_upload(
                    uploaded_file=uploaded_file,
                    material_key=material.material_key,
                    kind=material.kind,
                    source="canvas_native",
                    generation_id=generation_id,
                ),
                material=material,
            )

        markdown = _build_synthetic_markdown(material)
        file_name = _synthetic_markdown_file_name(material)
        uploaded_file = self._openai_client.upload_file(
            file_name,
            markdown.encode("utf-8"),
        )
        self._mark_material(
            course_id=course_id,
            material=material,
            generation_id=generation_id,
            status="pending",
            openai_file_id=uploaded_file.id,
        )

        return _UploadedMaterial(
            material_key=material.material_key,
            kind=material.kind,
            title=material.title,
            uploaded_file=uploaded_file,
            attachment=_attachment_for_upload(
                uploaded_file=uploaded_file,
                material_key=material.material_key,
                kind=material.kind,
                source="canvas_native",
                generation_id=generation_id,
            ),
            material=material,
        )

    def _upload_signed_file(
        self,
        *,
        course_id: str,
        generation_id: str,
        signed_file: SignedCanvasFile,
        existing_material: Mapping[str, Any] | None = None,
    ) -> _UploadedMaterial:
        existing_openai_file_id = _compact(
            existing_material.get("openai_file_id") if existing_material else None
        )
        if existing_openai_file_id is not None:
            uploaded_file = UploadedFile(
                id=existing_openai_file_id,
                filename=signed_file.file_name,
            )
            self._mark_signed_file(
                course_id=course_id,
                signed_file=signed_file,
                generation_id=generation_id,
                status="pending",
                openai_file_id=uploaded_file.id,
            )
            return _UploadedMaterial(
                material_key=signed_file.material_key,
                kind="file",
                title=signed_file.title,
                uploaded_file=uploaded_file,
                attachment=_attachment_for_upload(
                    uploaded_file=uploaded_file,
                    material_key=signed_file.material_key,
                    kind="file",
                    source="canvas_file",
                    generation_id=generation_id,
                ),
                signed_file=signed_file,
            )

        content = self._signed_file_content(signed_file)
        uploaded_file = self._openai_client.upload_file(signed_file.file_name, content)
        self._mark_signed_file(
            course_id=course_id,
            signed_file=signed_file,
            generation_id=generation_id,
            status="pending",
            openai_file_id=uploaded_file.id,
        )

        return _UploadedMaterial(
            material_key=signed_file.material_key,
            kind="file",
            title=signed_file.title,
            uploaded_file=uploaded_file,
            attachment=_attachment_for_upload(
                uploaded_file=uploaded_file,
                material_key=signed_file.material_key,
                kind="file",
                source="canvas_file",
                generation_id=generation_id,
            ),
            signed_file=signed_file,
        )

    def _signed_file_content(self, signed_file: SignedCanvasFile) -> FileContent:
        if signed_file.content_bytes_or_stream is not None:
            return signed_file.content_bytes_or_stream

        signed_url = _compact(signed_file.signed_url)
        if signed_url is None:
            raise ValueError("signed_file requires content_bytes_or_stream or signed_url")

        request = Request(signed_url, headers={"User-Agent": "CanvasGPT/1.0"})
        try:
            with urlopen(
                request,
                timeout=self._signed_file_timeout_seconds,
            ) as response:
                content_length = _optional_int(response.headers.get("Content-Length"))
                if (
                    content_length is not None
                    and content_length > self._max_file_bytes
                ):
                    raise ValueError("signed file exceeds configured max_file_bytes")

                content = response.read(self._max_file_bytes + 1)
        except URLError as exc:
            raise ValueError("signed file download failed") from exc

        if len(content) > self._max_file_bytes:
            raise ValueError("signed file exceeds configured max_file_bytes")

        return content

    def _attach_uploaded_materials(
        self,
        *,
        course_id: str,
        generation_id: str,
        vector_store_id: str,
        uploads: Sequence[_UploadedMaterial],
        warnings: list[CourseIndexSyncWarning],
    ) -> _AttachmentCounts:
        total = _AttachmentCounts()
        for batch_uploads in _chunks(list(uploads), MAX_VECTOR_STORE_BATCH_SIZE):
            try:
                batch = self._openai_client.attach_file_batch(
                    vector_store_id,
                    [upload.attachment for upload in batch_uploads],
                )
                batch = self._wait_for_file_batch(
                    vector_store_id=vector_store_id,
                    batch=batch,
                )
            except Exception:
                for upload in batch_uploads:
                    self._mark_uploaded_material(
                        course_id=course_id,
                        generation_id=generation_id,
                        upload=upload,
                        status="failed",
                        error_type="vector_store_attach_failed",
                        error_message="Vector store attachment failed.",
                    )
                    warnings.append(
                        CourseIndexSyncWarning(
                            material_key=upload.material_key,
                            title=upload.title,
                            reason="vector_store_attach_failed",
                            message="Vector store attachment failed.",
                        )
                    )
                total = _add_counts(
                    total,
                    _AttachmentCounts(failed=len(batch_uploads)),
                )
                continue

            counts = _counts_from_batch(batch, expected_count=len(batch_uploads))
            status_value = _material_status_from_counts(counts)
            for upload in batch_uploads:
                self._mark_uploaded_material(
                    course_id=course_id,
                    generation_id=generation_id,
                    upload=upload,
                    status=status_value,
                )
                warning = _warning_for_attachment_status(
                    upload=upload,
                    counts=counts,
                    status=status_value,
                )
                if warning is not None:
                    warnings.append(warning)
            total = _add_counts(total, counts)

        return total

    def _wait_for_file_batch(
        self,
        *,
        vector_store_id: str,
        batch: FileBatch,
    ) -> FileBatch:
        current_batch = batch
        batch_id = current_batch.id
        if _is_terminal_batch_status(current_batch.status):
            return current_batch

        for _attempt in range(self._batch_poll_attempts):
            if self._batch_poll_interval_seconds:
                time.sleep(self._batch_poll_interval_seconds)

            current_batch = self._openai_client.retrieve_file_batch(
                vector_store_id,
                batch_id,
            )
            if not _is_vector_store_file_batch_id(current_batch.id):
                current_batch = FileBatch(
                    id=batch_id,
                    vector_store_id=current_batch.vector_store_id,
                    status=current_batch.status,
                    file_counts=current_batch.file_counts,
                )
            if _is_terminal_batch_status(current_batch.status):
                return current_batch

        return current_batch

    def _mark_material(
        self,
        *,
        course_id: str,
        material: _Material,
        generation_id: str,
        status: str,
        openai_file_id: str | None = None,
        error_type: str | None = None,
        error_message: str | None = None,
    ) -> None:
        self._repository.upsert_material_placeholder(
            course_id=course_id,
            material_key=material.material_key,
            kind=material.kind,
            title=material.title,
            canvas_url=material.canvas_url,
            canvas_updated_at=material.canvas_updated_at,
            content_hash=material.content_hash,
            size=material.size,
            content_type=material.content_type,
            file_name=material.file_name,
            openai_file_id=openai_file_id,
            generation_id=generation_id,
            status=status,
            error_type=error_type,
            error_message=error_message,
        )

    def _mark_signed_file(
        self,
        *,
        course_id: str,
        signed_file: SignedCanvasFile,
        generation_id: str,
        status: str,
        openai_file_id: str | None = None,
        error_type: str | None = None,
        error_message: str | None = None,
    ) -> None:
        self._repository.upsert_material_placeholder(
            course_id=course_id,
            material_key=signed_file.material_key,
            kind="file",
            title=signed_file.title,
            size=signed_file.size,
            content_type=signed_file.content_type,
            file_name=signed_file.file_name,
            openai_file_id=openai_file_id,
            generation_id=generation_id,
            status=status,
            error_type=error_type,
            error_message=error_message,
        )

    def _mark_uploaded_material(
        self,
        *,
        course_id: str,
        generation_id: str,
        upload: _UploadedMaterial,
        status: str,
        error_type: str | None = None,
        error_message: str | None = None,
    ) -> None:
        if upload.material is not None:
            self._mark_material(
                course_id=course_id,
                material=upload.material,
                generation_id=generation_id,
                status=status,
                openai_file_id=upload.uploaded_file.id,
                error_type=error_type,
                error_message=error_message,
            )
            return

        if upload.signed_file is not None:
            self._mark_signed_file(
                course_id=course_id,
                signed_file=upload.signed_file,
                generation_id=generation_id,
                status=status,
                openai_file_id=upload.uploaded_file.id,
                error_type=error_type,
                error_message=error_message,
            )
            return

        self._repository.upsert_material_placeholder(
            course_id=course_id,
            material_key=upload.material_key,
            kind=upload.kind,
            title=upload.title,
            openai_file_id=upload.uploaded_file.id,
            generation_id=generation_id,
            status=status,
            error_type=error_type,
            error_message=error_message,
        )

    def _create_sync_run(self, *, course_id: str, generation_id: str) -> Mapping[str, Any]:
        return self._repository.create_sync_run_placeholder(
            course_id=course_id,
            generation_id=generation_id,
            status="pending",
        )

    def _set_active_generation(self, *, course_id: str, generation_id: str) -> None:
        self._repository.set_active_generation(
            course_id=course_id,
            generation_id=generation_id,
            sync_status="indexing",
        )

    def _mark_course_sync_status(
        self,
        *,
        course_id: str,
        sync_status: str,
        last_synced_at: str | None,
    ) -> None:
        self._repository.mark_course_sync_status(
            course_id=course_id,
            sync_status=sync_status,
            last_synced_at=last_synced_at,
        )

    def _complete_sync_run(
        self,
        *,
        sync_run_id: str,
        status: str,
        indexed_count: int,
        pending_count: int,
        skipped_count: int,
        failed_count: int,
        completed_at: str | None,
    ) -> None:
        if hasattr(self._repository, "complete_sync_run"):
            self._repository.complete_sync_run(
                sync_run_id=sync_run_id,
                status=status,
                indexed_count=indexed_count,
                pending_count=pending_count,
                skipped_count=skipped_count,
                failed_count=failed_count,
            )
            return

        if not hasattr(self._repository, "connect"):
            return

        with self._repository.connect() as connection:
            connection.execute(
                """
                UPDATE sync_runs
                SET
                    status = ?,
                    indexed_count = ?,
                    pending_count = ?,
                    skipped_count = ?,
                    failed_count = ?,
                    completed_at = ?
                WHERE id = ?
                """,
                (
                    status,
                    indexed_count,
                    pending_count,
                    skipped_count,
                    failed_count,
                    completed_at,
                    sync_run_id,
                ),
            )

    def _existing_materials_by_key(
        self,
        *,
        course_id: str,
    ) -> dict[str, Mapping[str, Any]]:
        if not hasattr(self._repository, "list_materials_by_course"):
            return {}

        return {
            row["material_key"]: row
            for row in self._repository.list_materials_by_course(course_id=course_id)
            if _compact(row.get("material_key"))
        }

    def _timestamp(self) -> str:
        timestamp = self._now()
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=UTC)

        return timestamp.astimezone(UTC).isoformat()


def sync_course_index(
    *,
    repository: Any,
    openai_client: OpenAIClientProtocol,
    course_index_id: str,
    generation_id: str | None = None,
    materials: Sequence[CourseIndexMaterial | Mapping[str, Any] | Any] = (),
    signed_files: Sequence[SignedCanvasFile | Mapping[str, Any] | Any] = (),
    now: Callable[[], datetime] | None = None,
    max_file_bytes: int = DEFAULT_MAX_FILE_BYTES,
    batch_poll_attempts: int = DEFAULT_BATCH_POLL_ATTEMPTS,
    batch_poll_interval_seconds: float = DEFAULT_BATCH_POLL_INTERVAL_SECONDS,
) -> CourseIndexSyncResult:
    service = CourseIndexSyncService(
        repository=repository,
        openai_client=openai_client,
        now=now,
        max_file_bytes=max_file_bytes,
        batch_poll_attempts=batch_poll_attempts,
        batch_poll_interval_seconds=batch_poll_interval_seconds,
    )
    return service.sync(
        course_index_id=course_index_id,
        generation_id=generation_id,
        materials=materials,
        signed_files=signed_files,
    )


def _coerce_material(value: CourseIndexMaterial | Mapping[str, Any] | Any) -> _Material:
    return _Material(
        material_key=_required_text(
            _field(value, "material_key", "materialKey"),
            "material_key",
        ),
        kind=_required_text(_field(value, "kind"), "kind"),
        title=_compact(_field(value, "title")),
        canvas_url=_compact(_field(value, "canvas_url", "canvasUrl")),
        canvas_updated_at=_compact(
            _field(value, "canvas_updated_at", "canvasUpdatedAt")
        ),
        content_hash=_compact(_field(value, "content_hash", "contentHash")),
        size=_optional_int(_field(value, "size")),
        content_type=_compact(_field(value, "content_type", "contentType")),
        file_name=_compact(_field(value, "file_name", "fileName")),
        supported_for_indexing=bool(
            _field(value, "supported_for_indexing", "supportedForIndexing", default=True)
        ),
        raw=value,
    )


def _coerce_signed_file(value: SignedCanvasFile | Mapping[str, Any] | Any) -> SignedCanvasFile:
    if isinstance(value, SignedCanvasFile):
        return value

    content = _field(value, "content_bytes_or_stream", "contentBytesOrStream")
    if content is None:
        content = _field(value, "content_bytes", "contentBytes")
    if content is None:
        content = _field(value, "content")
    if isinstance(content, str):
        content = content.encode("utf-8")

    content_base64 = _compact(_field(value, "content_base64", "contentBase64"))
    if content is None and content_base64 is not None:
        content = base64.b64decode(content_base64)

    material_key = _required_text(
        _field(value, "material_key", "materialKey"),
        "material_key",
    )
    return SignedCanvasFile(
        material_key=material_key,
        file_name=(
            _compact(_field(value, "file_name", "fileName", "name"))
            or _safe_file_stem(material_key)
        ),
        signed_url=_compact(_field(value, "signed_url", "signedUrl")),
        content_bytes_or_stream=content,
        content_type=_compact(_field(value, "content_type", "contentType")),
        size=_optional_int(_field(value, "size")),
        title=_compact(_field(value, "title")),
    )


def _is_canvas_file_material(material: _Material) -> bool:
    return material.kind.strip().lower() in {"file", "canvas_file"}


def _build_synthetic_markdown(material: _Material) -> str:
    raw = material.raw
    body = _compact(
        _field(
            raw,
            "markdown",
            "body",
            "description",
            "content",
            "text",
            "html",
            default=None,
        )
    )
    try:
        from backend.course_index.markdown import serialize_material_markdown
    except ImportError:
        return _fallback_synthetic_markdown(material=material, body=body)

    material_payload: CourseIndexMaterial | Mapping[str, Any]
    if isinstance(raw, CourseIndexMaterial | Mapping):
        material_payload = raw
    else:
        material_payload = {
            "material_key": material.material_key,
            "kind": material.kind,
            "title": material.title,
            "canvas_url": material.canvas_url,
            "canvas_updated_at": material.canvas_updated_at,
            "file_name": material.file_name,
        }

    return serialize_material_markdown(
        material=material_payload,
        body=body,
    )


def _fallback_synthetic_markdown(*, material: _Material, body: str | None) -> str:
    content = _compact(
        _field(
            material.raw,
            "markdown",
            "body",
            "description",
            "content",
            "text",
            "html",
            default=None,
        )
    )
    if body is not None:
        content = body

    lines = [
        f"# {material.title or material.material_key}",
        "",
        f"- Material key: {material.material_key}",
        f"- Kind: {material.kind}",
    ]
    if material.canvas_url:
        lines.append(f"- Canvas URL: {material.canvas_url}")
    if material.canvas_updated_at:
        lines.append(f"- Canvas updated at: {material.canvas_updated_at}")
    if content:
        lines.extend(["", "## Content", "", content])

    return "\n".join(lines).strip() + "\n"


def _synthetic_markdown_file_name(material: _Material) -> str:
    stem = _safe_file_stem(material.title or material.material_key)
    return f"{stem}.md"


def _attachment_for_upload(
    *,
    uploaded_file: UploadedFile,
    material_key: str,
    kind: str,
    source: str,
    generation_id: str,
) -> VectorStoreFileAttachment:
    return VectorStoreFileAttachment(
        file_id=uploaded_file.id,
        attributes={
            "material_key": material_key,
            "material_kind": kind,
            "source": source,
            "generation_id": generation_id,
        },
    )


def _counts_from_batch(batch: FileBatch, *, expected_count: int) -> _AttachmentCounts:
    counts = dict(batch.file_counts)
    completed = _count(counts, "completed", "succeeded", "ready")
    failed = _count(counts, "failed", "cancelled", "canceled", "expired")
    pending = _count(counts, "pending", "in_progress", "queued", "processing")
    counted = completed + failed + pending
    if counted:
        pending += max(0, expected_count - counted)
        return _AttachmentCounts(indexed=completed, pending=pending, failed=failed)

    status = _compact(batch.status)
    if status in {"completed", "ready", "succeeded"}:
        return _AttachmentCounts(indexed=expected_count)
    if status in {"failed", "cancelled", "canceled", "expired"}:
        return _AttachmentCounts(failed=expected_count)

    return _AttachmentCounts(pending=expected_count)


def _is_terminal_batch_status(status: str | None) -> bool:
    return _compact(status) in {
        "completed",
        "ready",
        "succeeded",
        "failed",
        "cancelled",
        "canceled",
        "expired",
    }


def _is_vector_store_file_batch_id(value: str | None) -> bool:
    text = _compact(value)
    return text is not None and text.startswith(("vsfb_", "batch_"))


def _material_status_from_counts(counts: _AttachmentCounts) -> str:
    if counts.failed and not counts.indexed and not counts.pending:
        return "failed"
    if counts.indexed and not counts.pending and not counts.failed:
        return "indexed"

    return "pending"


def _warning_for_attachment_status(
    *,
    upload: _UploadedMaterial,
    counts: _AttachmentCounts,
    status: str,
) -> CourseIndexSyncWarning | None:
    if status == "failed":
        return CourseIndexSyncWarning(
            material_key=upload.material_key,
            title=upload.title,
            reason="vector_store_attach_failed",
            message="Vector store attachment failed.",
        )

    if counts.failed:
        return CourseIndexSyncWarning(
            material_key=upload.material_key,
            title=upload.title,
            reason="vector_store_partial_failure",
            message="Vector store attachment reported partial failure.",
        )

    if status == "pending" or counts.pending:
        return CourseIndexSyncWarning(
            material_key=upload.material_key,
            title=upload.title,
            reason="vector_store_pending",
            message="Vector store attachment is still processing.",
        )

    return None


def _result_status(
    *,
    indexed_count: int,
    pending_count: int,
    skipped_count: int,
    failed_count: int,
) -> CourseIndexSyncStatus:
    if indexed_count < 1:
        return "failed"
    if pending_count or skipped_count or failed_count:
        return "partial"

    return "ready"


def _add_counts(left: _AttachmentCounts, right: _AttachmentCounts) -> _AttachmentCounts:
    return _AttachmentCounts(
        indexed=left.indexed + right.indexed,
        pending=left.pending + right.pending,
        failed=left.failed + right.failed,
    )


def _count(counts: Mapping[str, int], *keys: str) -> int:
    return sum(int(counts.get(key, 0)) for key in keys)


def _chunks(items: Sequence[_UploadedMaterial], size: int) -> list[list[_UploadedMaterial]]:
    return [list(items[index : index + size]) for index in range(0, len(items), size)]


def _field(value: Any, *names: str, default: Any = None) -> Any:
    if isinstance(value, Mapping):
        for name in names:
            if name in value:
                return value[name]
        return default

    for name in names:
        if hasattr(value, name):
            return getattr(value, name)

    if hasattr(value, "model_dump"):
        dumped = value.model_dump(by_alias=False)
        if isinstance(dumped, Mapping):
            for name in names:
                if name in dumped:
                    return dumped[name]

    return default


def _compact(value: object) -> str | None:
    if value is None:
        return None

    text = str(value).strip()
    return text or None


def _required_text(value: object, field_name: str) -> str:
    text = _compact(value)
    if text is None:
        raise CourseIndexSyncError(
            "invalid_request",
            f"{field_name} is required.",
        )

    return text


def _optional_int(value: object) -> int | None:
    if value is None:
        return None

    return int(value)


def _new_generation_id() -> str:
    return f"sync_{uuid.uuid4().hex}"


def _safe_file_stem(value: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip(".-")
    return stem[:80] or "canvas-material"
