from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from backend.catalog.repository import CatalogRepository
from backend.course_index.sync import (
    CourseIndexSyncError,
    SignedCanvasFile,
    sync_course_index,
)
from backend.openai_client import (
    DeletionResult,
    FileBatch,
    FileContent,
    FileSearchFilters,
    ResponseInput,
    ResponseResult,
    UploadedFile,
    VectorStore,
    VectorStoreFileAttachment,
    VectorStoreMetadata,
)


FIXED_NOW = datetime(2026, 6, 9, 12, 0, tzinfo=UTC)


def test_sync_uploads_native_markdown_before_signed_files_and_marks_ready(
    tmp_path: Path,
) -> None:
    repository = _repository(tmp_path)
    course = _indexed_course(repository)
    openai_client = FakeOpenAIClient(batch_status="completed")

    result = sync_course_index(
        repository=repository,
        openai_client=openai_client,
        course_index_id=course["id"],
        generation_id="sync_2026_06_09",
        materials=[
            {
                "materialKey": "assignment:1",
                "kind": "assignment",
                "title": "Lab Report",
                "body": "Submit your lab report by Friday.",
            },
            {
                "materialKey": "file:1",
                "kind": "file",
                "title": "Slides",
                "fileName": "slides.pdf",
            },
        ],
        signed_files=[
            SignedCanvasFile(
                material_key="file:1",
                file_name="slides.pdf",
                content_bytes_or_stream=b"%PDF",
                title="Slides",
            )
        ],
        now=lambda: FIXED_NOW,
    )

    stored_course = repository.get_course_by_id(course["id"])
    materials = {
        material["material_key"]: material
        for material in repository.list_materials_by_course(course_id=course["id"])
    }
    sync_run = _only_sync_run(repository, course_id=course["id"])

    assert result.status == "ready"
    assert result.native_indexed_count == 1
    assert result.file_indexed_count == 1
    assert result.pending_file_count == 0
    assert result.failed_count == 0
    assert [call["file_name"] for call in openai_client.upload_file_calls] == [
        "Lab-Report.md",
        "slides.pdf",
    ]
    assert b"Submit your lab report by Friday." in openai_client.upload_file_calls[0][
        "content"
    ]
    assert [len(call["files"]) for call in openai_client.attach_file_batch_calls] == [
        1,
        1,
    ]
    assert stored_course is not None
    assert stored_course["active_generation_id"] == "sync_2026_06_09"
    assert stored_course["sync_status"] == "ready"
    assert stored_course["last_synced_at"] == "2026-06-09T12:00:00+00:00"
    assert materials["assignment:1"]["status"] == "indexed"
    assert materials["file:1"]["status"] == "indexed"
    assert sync_run["status"] == "ready"
    assert sync_run["indexed_count"] == 2


def test_sync_uploads_native_materials_only_and_marks_ready(
    tmp_path: Path,
) -> None:
    repository = _repository(tmp_path)
    course = _indexed_course(repository)
    openai_client = FakeOpenAIClient(batch_status="completed")

    result = sync_course_index(
        repository=repository,
        openai_client=openai_client,
        course_index_id=course["id"],
        generation_id="sync_native_only",
        materials=[
            {
                "materialKey": "page:overview",
                "kind": "page",
                "title": "Course Overview",
                "body": "<p>Welcome to Biology 101.</p>",
            },
            {
                "materialKey": "assignment:1",
                "kind": "assignment",
                "title": "Lab Report",
                "body": "Submit your lab report by Friday.",
            },
        ],
        now=lambda: FIXED_NOW,
        batch_poll_attempts=0,
    )

    stored_course = repository.get_course_by_id(course["id"])
    materials = repository.list_materials_by_course(course_id=course["id"])
    sync_run = _only_sync_run(repository, course_id=course["id"])

    assert result.status == "ready"
    assert result.native_indexed_count == 2
    assert result.file_indexed_count == 0
    assert result.pending_file_count == 0
    assert result.failed_count == 0
    assert [call["file_name"] for call in openai_client.upload_file_calls] == [
        "Course-Overview.md",
        "Lab-Report.md",
    ]
    assert [len(call["files"]) for call in openai_client.attach_file_batch_calls] == [
        2
    ]
    assert stored_course is not None
    assert stored_course["sync_status"] == "ready"
    assert stored_course["last_synced_at"] == "2026-06-09T12:00:00+00:00"
    assert {material["status"] for material in materials} == {"indexed"}
    assert "Submit your lab report by Friday." not in str(materials)
    assert sync_run["status"] == "ready"
    assert sync_run["indexed_count"] == 2


def test_sync_splits_vector_store_attachments_into_batches_of_500(
    tmp_path: Path,
) -> None:
    repository = _repository(tmp_path)
    course = _indexed_course(repository)
    openai_client = FakeOpenAIClient(batch_status="completed")
    signed_files = [
        SignedCanvasFile(
            material_key=f"file:{index}",
            file_name=f"file-{index}.pdf",
            content_bytes_or_stream=b"file bytes",
        )
        for index in range(501)
    ]

    result = sync_course_index(
        repository=repository,
        openai_client=openai_client,
        course_index_id=course["id"],
        generation_id="sync_many",
        signed_files=signed_files,
        now=lambda: FIXED_NOW,
    )

    assert result.status == "ready"
    assert result.file_indexed_count == 501
    assert [len(call["files"]) for call in openai_client.attach_file_batch_calls] == [
        500,
        1,
    ]


def test_sync_marks_partial_when_one_signed_file_upload_fails(
    tmp_path: Path,
) -> None:
    repository = _repository(tmp_path)
    course = _indexed_course(repository)
    openai_client = FakeOpenAIClient(
        batch_status="completed",
        upload_fail_file_names={"broken.pdf"},
    )

    result = sync_course_index(
        repository=repository,
        openai_client=openai_client,
        course_index_id=course["id"],
        generation_id="sync_partial_file_failure",
        signed_files=[
            SignedCanvasFile(
                material_key="file:ok",
                file_name="ok.pdf",
                content_bytes_or_stream=b"%PDF ok",
                title="Readable PDF",
                signed_url="https://canvas.example.edu/files/ok/download?verifier=secret",
            ),
            SignedCanvasFile(
                material_key="file:broken",
                file_name="broken.pdf",
                content_bytes_or_stream=b"%PDF broken",
                title="Broken PDF",
                signed_url="https://canvas.example.edu/files/broken/download?verifier=secret",
            ),
        ],
        now=lambda: FIXED_NOW,
    )

    stored_course = repository.get_course_by_id(course["id"])
    materials = {
        material["material_key"]: material
        for material in repository.list_materials_by_course(course_id=course["id"])
    }
    sync_run = _only_sync_run(repository, course_id=course["id"])

    assert result.status == "partial"
    assert result.file_indexed_count == 1
    assert result.failed_count == 1
    assert result.warnings[0].reason == "file_upload_failed"
    assert [call["file_name"] for call in openai_client.upload_file_calls] == [
        "ok.pdf"
    ]
    assert [len(call["files"]) for call in openai_client.attach_file_batch_calls] == [
        1
    ]
    assert stored_course is not None
    assert stored_course["sync_status"] == "partial"
    assert stored_course["last_synced_at"] == "2026-06-09T12:00:00+00:00"
    assert materials["file:ok"]["status"] == "indexed"
    assert materials["file:broken"]["status"] == "failed"
    assert materials["file:broken"]["error_type"] == "file_upload_failed"
    assert "verifier=secret" not in str(materials)
    assert sync_run["status"] == "partial"
    assert sync_run["indexed_count"] == 1
    assert sync_run["failed_count"] == 1


def test_sync_marks_failed_when_no_usable_source_indexes(
    tmp_path: Path,
) -> None:
    repository = _repository(tmp_path)
    course = _indexed_course(repository)
    openai_client = FakeOpenAIClient(upload_fail_file_names={"broken.pdf"})

    result = sync_course_index(
        repository=repository,
        openai_client=openai_client,
        course_index_id=course["id"],
        generation_id="sync_no_usable_sources",
        materials=[
            {
                "materialKey": "canvas_url:https://tool.example.invalid",
                "kind": "canvas_url",
                "title": "External Tool",
                "supportedForIndexing": False,
            }
        ],
        signed_files=[
            SignedCanvasFile(
                material_key="file:broken",
                file_name="broken.pdf",
                content_bytes_or_stream=b"%PDF broken",
                title="Broken PDF",
            )
        ],
        now=lambda: FIXED_NOW,
    )

    stored_course = repository.get_course_by_id(course["id"])
    materials = {
        material["material_key"]: material
        for material in repository.list_materials_by_course(course_id=course["id"])
    }
    sync_run = _only_sync_run(repository, course_id=course["id"])

    assert result.status == "failed"
    assert result.native_indexed_count == 0
    assert result.file_indexed_count == 0
    assert result.skipped_count == 1
    assert result.failed_count == 1
    assert openai_client.attach_file_batch_calls == []
    assert stored_course is not None
    assert stored_course["sync_status"] == "failed"
    assert stored_course["last_synced_at"] is None
    assert materials["canvas_url:https://tool.example.invalid"]["status"] == "skipped"
    assert materials["file:broken"]["status"] == "failed"
    assert sync_run["status"] == "failed"
    assert sync_run["indexed_count"] == 0
    assert sync_run["skipped_count"] == 1
    assert sync_run["failed_count"] == 1


@pytest.mark.parametrize(
    ("course_setup", "expected_code"),
    [
        ("missing", "course_not_found"),
        ("no_consent", "consent_required"),
        ("no_vector_store", "vector_store_missing"),
    ],
)
def test_sync_validates_course_consent_and_vector_store_before_uploading(
    tmp_path: Path,
    course_setup: str,
    expected_code: str,
) -> None:
    repository = _repository(tmp_path)
    course_id = "course_missing"
    if course_setup == "no_consent":
        course = repository.get_or_create_course(
            canvas_origin="https://canvas.example.edu",
            course_id="12345",
            canvas_user_id="67890",
        )
        repository.update_course_vector_store(
            course_id=course["id"],
            vector_store_id="vs_ready",
            expires_at=None,
        )
        course_id = course["id"]
    elif course_setup == "no_vector_store":
        course = repository.get_or_create_course(
            canvas_origin="https://canvas.example.edu",
            course_id="12345",
            canvas_user_id="67890",
        )
        repository.set_consent_state(course_id=course["id"], consent_granted=True)
        course_id = course["id"]

    openai_client = FakeOpenAIClient()

    with pytest.raises(CourseIndexSyncError) as exc_info:
        sync_course_index(
            repository=repository,
            openai_client=openai_client,
            course_index_id=course_id,
            materials=[
                {
                    "materialKey": "assignment:1",
                    "kind": "assignment",
                    "title": "Lab Report",
                }
            ],
            now=lambda: FIXED_NOW,
        )

    assert exc_info.value.code == expected_code
    assert openai_client.upload_file_calls == []
    assert openai_client.attach_file_batch_calls == []


def test_sync_returns_failed_when_batch_is_not_yet_usable(
    tmp_path: Path,
) -> None:
    repository = _repository(tmp_path)
    course = _indexed_course(repository)
    openai_client = FakeOpenAIClient(batch_status="in_progress")

    result = sync_course_index(
        repository=repository,
        openai_client=openai_client,
        course_index_id=course["id"],
        generation_id="sync_pending",
        materials=[
            {
                "materialKey": "assignment:1",
                "kind": "assignment",
                "title": "Lab Report",
                "body": "Unindexed until OpenAI completes processing.",
            }
        ],
        now=lambda: FIXED_NOW,
        batch_poll_attempts=0,
    )

    stored_course = repository.get_course_by_id(course["id"])
    sync_run = _only_sync_run(repository, course_id=course["id"])

    assert result.status == "failed"
    assert result.native_indexed_count == 0
    assert result.pending_file_count == 1
    assert stored_course is not None
    assert stored_course["sync_status"] == "failed"
    assert stored_course["last_synced_at"] is None
    assert sync_run["status"] == "failed"
    assert sync_run["pending_count"] == 1


def test_sync_polls_batch_until_vector_store_files_complete(
    tmp_path: Path,
) -> None:
    repository = _repository(tmp_path)
    course = _indexed_course(repository)
    openai_client = FakeOpenAIClient(
        batch_status="in_progress",
        retrieve_batch_status="completed",
    )

    result = sync_course_index(
        repository=repository,
        openai_client=openai_client,
        course_index_id=course["id"],
        generation_id="sync_poll_completed",
        materials=[
            {
                "materialKey": "assignment:1",
                "kind": "assignment",
                "title": "Lab Report",
                "body": "Indexed after polling.",
            }
        ],
        now=lambda: FIXED_NOW,
        batch_poll_attempts=2,
        batch_poll_interval_seconds=0,
    )

    assert result.status == "ready"
    assert result.native_indexed_count == 1
    assert result.pending_file_count == 0
    assert openai_client.retrieve_file_batch_calls == [
        {"vector_store_id": "vs_ready", "batch_id": "batch_1"}
    ]


def test_sync_polling_keeps_original_batch_id_when_provider_echoes_vector_store_id(
    tmp_path: Path,
) -> None:
    repository = _repository(tmp_path)
    course = _indexed_course(repository)
    openai_client = FakeOpenAIClient(
        batch_status="in_progress",
        retrieve_batch_status="in_progress",
        retrieve_batch_ids=["vs_ready", "batch_1"],
    )

    result = sync_course_index(
        repository=repository,
        openai_client=openai_client,
        course_index_id=course["id"],
        generation_id="sync_bad_echo",
        materials=[
            {
                "materialKey": "assignment:1",
                "kind": "assignment",
                "title": "Lab Report",
                "body": "Still pending.",
            }
        ],
        now=lambda: FIXED_NOW,
        batch_poll_attempts=2,
        batch_poll_interval_seconds=0,
    )

    assert result.status == "failed"
    assert openai_client.retrieve_file_batch_calls == [
        {"vector_store_id": "vs_ready", "batch_id": "batch_1"},
        {"vector_store_id": "vs_ready", "batch_id": "batch_1"},
    ]


def test_sync_reuses_existing_openai_files_after_prior_attach_failure(
    tmp_path: Path,
) -> None:
    repository = _repository(tmp_path)
    course = _indexed_course(repository)
    repository.upsert_material_placeholder(
        course_id=course["id"],
        material_key="assignment:1",
        kind="assignment",
        title="Lab Report",
        openai_file_id="file_existing_assignment",
        status="failed",
        error_type="vector_store_attach_failed",
    )
    repository.upsert_material_placeholder(
        course_id=course["id"],
        material_key="file:1",
        kind="file",
        title="Slides",
        file_name="slides.pdf",
        openai_file_id="file_existing_slides",
        status="failed",
        error_type="vector_store_attach_failed",
    )
    openai_client = FakeOpenAIClient(batch_status="completed")

    result = sync_course_index(
        repository=repository,
        openai_client=openai_client,
        course_index_id=course["id"],
        generation_id="sync_reuse_existing_files",
        materials=[
            {
                "materialKey": "assignment:1",
                "kind": "assignment",
                "title": "Lab Report",
                "body": "Already uploaded.",
            }
        ],
        signed_files=[
            SignedCanvasFile(
                material_key="file:1",
                file_name="slides.pdf",
                content_bytes_or_stream=b"should not be read",
                title="Slides",
            )
        ],
        now=lambda: FIXED_NOW,
    )

    attached_file_ids = [
        attachment.file_id
        for call in openai_client.attach_file_batch_calls
        for attachment in call["files"]
    ]
    assert result.status == "ready"
    assert openai_client.upload_file_calls == []
    assert attached_file_ids == ["file_existing_assignment", "file_existing_slides"]


class FakeOpenAIClient:
    def __init__(
        self,
        *,
        batch_status: str = "completed",
        retrieve_batch_status: str | None = None,
        retrieve_batch_ids: list[str] | None = None,
        upload_fail_file_names: set[str] | None = None,
    ) -> None:
        self.batch_status = batch_status
        self.retrieve_batch_status = retrieve_batch_status
        self.retrieve_batch_ids = list(retrieve_batch_ids or [])
        self.upload_fail_file_names = upload_fail_file_names or set()
        self.upload_file_calls: list[dict[str, Any]] = []
        self.attach_file_batch_calls: list[dict[str, Any]] = []
        self.retrieve_file_batch_calls: list[dict[str, Any]] = []

    def create_vector_store(
        self,
        name: str,
        expires_after_days: int,
        metadata: VectorStoreMetadata,
    ) -> VectorStore:
        return VectorStore(id="vs_created", name=name, metadata=dict(metadata))

    def retrieve_vector_store(self, vector_store_id: str) -> VectorStore:
        return VectorStore(id=vector_store_id)

    def delete_vector_store(self, vector_store_id: str) -> DeletionResult:
        return DeletionResult(id=vector_store_id, deleted=True)

    def upload_file(
        self,
        file_name: str,
        content_bytes_or_stream: FileContent,
    ) -> UploadedFile:
        if file_name in self.upload_fail_file_names:
            raise RuntimeError("upload failed")

        file_id = f"file_{len(self.upload_file_calls) + 1}"
        content = _bytes_content(content_bytes_or_stream)
        self.upload_file_calls.append(
            {
                "file_name": file_name,
                "content": content,
            }
        )
        return UploadedFile(id=file_id, filename=file_name, bytes=len(content))

    def delete_file(self, file_id: str) -> DeletionResult:
        return DeletionResult(id=file_id, deleted=True)

    def attach_file_batch(
        self,
        vector_store_id: str,
        files_with_attributes: Sequence[VectorStoreFileAttachment],
    ) -> FileBatch:
        self.attach_file_batch_calls.append(
            {
                "vector_store_id": vector_store_id,
                "files": list(files_with_attributes),
            }
        )
        count_key = "completed" if self.batch_status == "completed" else "in_progress"
        return FileBatch(
            id=f"batch_{len(self.attach_file_batch_calls)}",
            vector_store_id=vector_store_id,
            status=self.batch_status,
            file_counts={count_key: len(files_with_attributes)},
        )

    def retrieve_file_batch(
        self,
        vector_store_id: str,
        batch_id: str,
    ) -> FileBatch:
        self.retrieve_file_batch_calls.append(
            {"vector_store_id": vector_store_id, "batch_id": batch_id}
        )
        status = self.retrieve_batch_status or self.batch_status
        count_key = "completed" if status == "completed" else "in_progress"
        response_batch_id = (
            self.retrieve_batch_ids.pop(0)
            if self.retrieve_batch_ids
            else batch_id
        )
        return FileBatch(
            id=response_batch_id,
            vector_store_id=vector_store_id,
            status=status,
            file_counts={count_key: 1},
        )

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


def _indexed_course(repository: CatalogRepository) -> Mapping[str, Any]:
    course = repository.get_or_create_course(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        canvas_user_id="67890",
    )
    repository.set_consent_state(course_id=course["id"], consent_granted=True)
    return repository.update_course_vector_store(
        course_id=course["id"],
        vector_store_id="vs_ready",
        expires_at="2026-06-16T12:00:00+00:00",
        sync_status="pending",
    )


def _only_sync_run(
    repository: CatalogRepository,
    *,
    course_id: str,
) -> Mapping[str, Any]:
    with repository.connect() as connection:
        cursor = connection.execute(
            "SELECT * FROM sync_runs WHERE course_id = ?",
            (course_id,),
        )
        rows = [dict(row) for row in cursor.fetchall()]

    assert len(rows) == 1
    return rows[0]


def _bytes_content(value: FileContent) -> bytes:
    if isinstance(value, bytes):
        return value

    return value.read()
