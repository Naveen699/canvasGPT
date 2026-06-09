from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from backend.catalog.repository import CatalogRepository
from backend.config import BackendConfig
from backend.course_index.vector_store_lifecycle import (
    VectorStoreLifecycleError,
    ensure_course_vector_store,
)
from backend.openai_client import (
    DeletionResult,
    FileBatch,
    FileSearchFilters,
    OpenAIClientProtocol,
    ResponseInput,
    ResponseResult,
    UploadedFile,
    VectorStore,
    VectorStoreFileAttachment,
    VectorStoreMetadata,
)


FIXED_NOW = datetime(2026, 6, 9, 12, 0, tzinfo=UTC)


def test_create_vector_store_records_course_pointer_and_retention(
    tmp_path: Path,
) -> None:
    repository = _repository(tmp_path)
    course = _consented_course(repository)
    openai_client = FakeOpenAIClient(vector_store_id="vs_created")

    result = ensure_course_vector_store(
        repository=repository,
        openai_client=openai_client,
        config=_config(tmp_path, retention_days=14),
        course_index_id=course["id"],
        now=lambda: FIXED_NOW,
    )

    stored_course = repository.get_course_by_id(course["id"])
    assert result.status == "created"
    assert result.vector_store_id == "vs_created"
    assert result.course["vector_store_id"] == "vs_created"
    assert stored_course is not None
    assert stored_course["vector_store_id"] == "vs_created"
    assert stored_course["sync_status"] == "pending"
    assert stored_course["last_active_at"] == stored_course["updated_at"]
    assert stored_course["expires_at"] == "2026-06-23T12:00:00+00:00"
    assert openai_client.create_vector_store_calls == [
        {
            "name": openai_client.create_vector_store_calls[0]["name"],
            "expires_after_days": 14,
            "metadata": {"course_index_id": course["id"]},
        }
    ]


def test_reuse_existing_vector_store_without_openai_create_call(
    tmp_path: Path,
) -> None:
    repository = _repository(tmp_path)
    course = _consented_course(repository)
    repository.update_course_vector_store(
        course_id=course["id"],
        vector_store_id="vs_existing",
        expires_at="2026-06-16T12:00:00+00:00",
        sync_status="ready",
    )
    openai_client = FakeOpenAIClient()

    result = ensure_course_vector_store(
        repository=repository,
        openai_client=openai_client,
        config=_config(tmp_path),
        course_index_id=course["id"],
        now=lambda: FIXED_NOW,
    )

    assert result.status == "reused"
    assert result.vector_store_id == "vs_existing"
    assert result.course["vector_store_id"] == "vs_existing"
    assert result.course["sync_status"] == "ready"
    assert result.course["expires_at"] == "2026-06-16T12:00:00+00:00"
    assert result.course["last_active_at"] == result.course["updated_at"]
    assert openai_client.create_vector_store_calls == []


def test_consent_denial_does_not_create_vector_store(
    tmp_path: Path,
) -> None:
    repository = _repository(tmp_path)
    course = repository.get_or_create_course(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        canvas_user_id="student@example.edu",
    )
    openai_client = FakeOpenAIClient()

    with pytest.raises(VectorStoreLifecycleError) as exc_info:
        ensure_course_vector_store(
            repository=repository,
            openai_client=openai_client,
            config=_config(tmp_path),
            course_index_id=course["id"],
            now=lambda: FIXED_NOW,
        )

    stored_course = repository.get_course_by_id(course["id"])
    assert exc_info.value.code == "consent_required"
    assert "consent" in exc_info.value.message
    assert stored_course is not None
    assert stored_course["vector_store_id"] is None
    assert stored_course["sync_status"] == "not_started"
    assert openai_client.create_vector_store_calls == []


def test_created_vector_store_name_excludes_raw_sensitive_values(
    tmp_path: Path,
) -> None:
    repository = _repository(tmp_path)
    course = _consented_course(
        repository,
        canvas_origin="https://student.canvas.example.edu/courses/biology-101",
        course_id="biology-101",
        course_name="Biology 101 With Student Name",
        canvas_user_id="student@example.edu",
    )
    openai_client = FakeOpenAIClient()

    ensure_course_vector_store(
        repository=repository,
        openai_client=openai_client,
        config=_config(tmp_path),
        course_index_id=course["id"],
        now=lambda: FIXED_NOW,
    )

    created_name = openai_client.create_vector_store_calls[0]["name"]
    assert isinstance(created_name, str)
    assert created_name.startswith("canvasgpt:")
    assert ":biology-101:" in created_name
    assert "student.canvas.example.edu" not in created_name
    assert "canvas.example.edu" not in created_name
    assert "student@example.edu" not in created_name
    assert "student" not in created_name
    assert "example.edu" not in created_name
    assert "Biology 101" not in created_name
    assert openai_client.create_vector_store_calls[0]["metadata"] == {
        "course_index_id": course["id"],
    }


def test_openai_failure_marks_course_failed_without_success_pointer(
    tmp_path: Path,
) -> None:
    repository = _repository(tmp_path)
    course = _consented_course(repository)
    openai_client = FakeOpenAIClient(create_error=RuntimeError("secret payload"))

    with pytest.raises(VectorStoreLifecycleError) as exc_info:
        ensure_course_vector_store(
            repository=repository,
            openai_client=openai_client,
            config=_config(tmp_path),
            course_index_id=course["id"],
            now=lambda: FIXED_NOW,
        )

    stored_course = repository.get_course_by_id(course["id"])
    assert exc_info.value.code == "setup_failed"
    assert exc_info.value.message == "Vector store setup failed."
    assert "secret payload" not in exc_info.value.message
    assert stored_course is not None
    assert stored_course["vector_store_id"] is None
    assert stored_course["last_synced_at"] is None
    assert stored_course["sync_status"] == "failed"
    assert openai_client.create_vector_store_calls


def test_fake_client_lifecycle_does_not_require_openai_api_key(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    repository = _repository(tmp_path)
    course = _consented_course(repository)

    result = ensure_course_vector_store(
        repository=repository,
        openai_client=FakeOpenAIClient(vector_store_id="vs_without_env_key"),
        config=_config(tmp_path),
        course_index_id=course["id"],
        now=lambda: FIXED_NOW,
    )

    assert result.vector_store_id == "vs_without_env_key"


def test_missing_course_returns_clear_local_error(tmp_path: Path) -> None:
    repository = _repository(tmp_path)
    openai_client = FakeOpenAIClient()

    with pytest.raises(VectorStoreLifecycleError) as exc_info:
        ensure_course_vector_store(
            repository=repository,
            openai_client=openai_client,
            config=_config(tmp_path),
            course_index_id="course_missing",
            now=lambda: FIXED_NOW,
        )

    assert exc_info.value.code == "course_not_found"
    assert openai_client.create_vector_store_calls == []


class FakeOpenAIClient:
    def __init__(
        self,
        *,
        vector_store_id: str = "vs_fake",
        create_error: Exception | None = None,
    ) -> None:
        self.vector_store_id = vector_store_id
        self.create_error = create_error
        self.create_vector_store_calls: list[dict[str, object]] = []

    def create_vector_store(
        self,
        name: str,
        expires_after_days: int,
        metadata: VectorStoreMetadata,
    ) -> VectorStore:
        self.create_vector_store_calls.append(
            {
                "name": name,
                "expires_after_days": expires_after_days,
                "metadata": dict(metadata),
            }
        )
        if self.create_error is not None:
            raise self.create_error

        return VectorStore(id=self.vector_store_id, name=name, metadata=dict(metadata))

    def retrieve_vector_store(self, vector_store_id: str) -> VectorStore:
        return VectorStore(id=vector_store_id)

    def delete_vector_store(self, vector_store_id: str) -> DeletionResult:
        return DeletionResult(id=vector_store_id, deleted=True)

    def upload_file(
        self,
        file_name: str,
        content_bytes_or_stream: bytes,
    ) -> UploadedFile:
        return UploadedFile(id=f"file_{file_name}", filename=file_name)

    def delete_file(self, file_id: str) -> DeletionResult:
        return DeletionResult(id=file_id, deleted=True)

    def attach_file_batch(
        self,
        vector_store_id: str,
        files_with_attributes: Sequence[VectorStoreFileAttachment],
    ) -> FileBatch:
        return FileBatch(id="batch_fake", vector_store_id=vector_store_id)

    def retrieve_file_batch(
        self,
        vector_store_id: str,
        batch_id: str,
    ) -> FileBatch:
        return FileBatch(id=batch_id, vector_store_id=vector_store_id)

    def create_response_with_file_search(
        self,
        model: str,
        input: ResponseInput,
        vector_store_id: str,
        filters: FileSearchFilters | None = None,
    ) -> ResponseResult:
        return ResponseResult(id="resp_fake", status="completed")


def _repository(tmp_path: Path) -> CatalogRepository:
    return CatalogRepository(tmp_path / "private" / "catalog.sqlite3")


def _config(tmp_path: Path, *, retention_days: int = 7) -> BackendConfig:
    return BackendConfig(
        openai_api_key=None,
        openai_response_model=None,
        db_path=tmp_path / "private" / "catalog.sqlite3",
        index_retention_days=retention_days,
        max_file_bytes=10_000,
        log_level=None,
    )


def _consented_course(
    repository: CatalogRepository,
    *,
    canvas_origin: str = "https://canvas.example.edu",
    course_id: str = "12345",
    course_name: str | None = "Biology 101",
    canvas_user_id: str | None = "67890",
    local_profile_id: str | None = None,
) -> Mapping[str, Any]:
    course = repository.get_or_create_course(
        canvas_origin=canvas_origin,
        course_id=course_id,
        course_name=course_name,
        canvas_user_id=canvas_user_id,
        local_profile_id=local_profile_id,
    )
    return repository.set_consent_state(course_id=course["id"], consent_granted=True)


assert isinstance(FakeOpenAIClient(), OpenAIClientProtocol)
