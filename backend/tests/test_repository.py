from datetime import UTC, datetime, timedelta
from pathlib import Path

import backend.catalog as catalog
from backend.catalog.repository import CatalogRepository


class MutableClock:
    def __init__(self) -> None:
        self.current = datetime(2026, 6, 9, 12, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.current

    def advance(self, *, seconds: int = 1) -> None:
        self.current += timedelta(seconds=seconds)


def test_same_origin_course_canvas_user_reuses_existing_course_row(
    tmp_path: Path,
) -> None:
    clock = MutableClock()
    repository = _repository(tmp_path, clock)

    created_course = repository.get_or_create_course(
        canvas_origin="https://Canvas.Example.edu/",
        course_id="12345",
        course_name="Biology 101",
        canvas_user_id="67890",
    )
    clock.advance()
    reused_course = repository.get_or_create_course(
        canvas_origin="https://canvas.example.edu/courses/12345",
        course_id="12345",
        course_name="Biology 101 - Updated",
        canvas_user_id="67890",
    )

    assert reused_course["id"] == created_course["id"]
    assert reused_course["course_name"] == "Biology 101 - Updated"
    assert reused_course["created_at"] == created_course["created_at"]
    assert reused_course["updated_at"] != created_course["updated_at"]
    assert reused_course["last_active_at"] == reused_course["updated_at"]


def test_same_origin_course_different_canvas_users_create_different_course_rows(
    tmp_path: Path,
) -> None:
    repository = _repository(tmp_path)

    first_course = repository.get_or_create_course(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        canvas_user_id="user_1",
    )
    second_course = repository.get_or_create_course(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        canvas_user_id="user_2",
    )

    assert first_course["id"] != second_course["id"]
    assert first_course["course_key_hash"] != second_course["course_key_hash"]


def test_local_profile_identity_resolves_independently_from_canvas_user_identity(
    tmp_path: Path,
) -> None:
    repository = _repository(tmp_path)

    canvas_user_course = repository.get_or_create_course(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        canvas_user_id="same-value",
        local_profile_id="same-value",
    )
    local_profile_course = repository.get_or_create_course(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        local_profile_id="same-value",
    )

    assert canvas_user_course["id"] != local_profile_course["id"]
    assert canvas_user_course["canvas_user_id"] == "same-value"
    assert canvas_user_course["local_profile_id"] is None
    assert local_profile_course["canvas_user_id"] is None
    assert local_profile_course["local_profile_id"] == "same-value"


def test_future_auth_fields_can_remain_null(tmp_path: Path) -> None:
    repository = _repository(tmp_path)

    course = repository.get_or_create_course(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        local_profile_id="profile_abc",
    )

    assert course["hosted_user_id"] is None
    assert course["auth_subject"] is None


def test_get_course_by_id_and_identity_helpers_return_created_course(
    tmp_path: Path,
) -> None:
    repository = _repository(tmp_path)
    created_course = repository.get_or_create_course(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        canvas_user_id="67890",
    )

    by_id = repository.get_course_by_id(created_course["id"])
    by_identity = repository.get_course_by_identity(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        canvas_user_id="67890",
    )

    assert by_id == created_course
    assert by_identity == created_course


def test_material_placeholder_upserts_metadata_without_changing_id(
    tmp_path: Path,
) -> None:
    clock = MutableClock()
    repository = _repository(tmp_path, clock)
    course = repository.get_or_create_course(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        canvas_user_id="67890",
    )

    created_material = repository.upsert_material_placeholder(
        course_id=course["id"],
        material_key="assignment:77",
        kind="assignment",
        title="Midterm Policy",
        status="pending",
    )
    clock.advance()
    updated_material = repository.upsert_material_placeholder(
        course_id=course["id"],
        material_key="assignment:77",
        kind="assignment",
        title="Midterm Policy Updated",
        canvas_url="https://canvas.example.edu/courses/12345/assignments/77",
        content_hash="sha256:abc",
        size=0,
        content_type="text/markdown",
        generation_id="sync_1",
        status="ready",
    )

    assert updated_material["id"] == created_material["id"]
    assert updated_material["created_at"] == created_material["created_at"]
    assert updated_material["updated_at"] != created_material["updated_at"]
    assert updated_material["title"] == "Midterm Policy Updated"
    assert updated_material["status"] == "ready"
    assert updated_material["content_hash"] == "sha256:abc"


def test_replace_material_placements_replaces_existing_rows(tmp_path: Path) -> None:
    repository = _repository(tmp_path)
    course = repository.get_or_create_course(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        local_profile_id="profile_abc",
    )

    first_placements = repository.replace_material_placements(
        course_id=course["id"],
        material_key="file:123",
        placements=[
            {
                "source_kind": "module",
                "module_id": "module_1",
                "module_name": "Week 1",
                "module_item_id": "item_1",
                "position": 1,
                "label": "Old label",
            }
        ],
    )
    second_placements = repository.replace_material_placements(
        course_id=course["id"],
        material_key="file:123",
        placements=[
            {"source_kind": "module", "position": 2, "label": "New label"},
            {"source_kind": "module", "position": 3, "label": "Second label"},
        ],
    )

    assert len(first_placements) == 1
    assert len(second_placements) == 2
    assert [placement["label"] for placement in second_placements] == [
        "New label",
        "Second label",
    ]


def test_create_sync_run_placeholder_uses_default_counts(tmp_path: Path) -> None:
    repository = _repository(tmp_path)
    course = repository.get_or_create_course(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        canvas_user_id="67890",
    )

    sync_run = repository.create_sync_run_placeholder(
        course_id=course["id"],
        generation_id="sync_1",
    )

    assert sync_run["course_id"] == course["id"]
    assert sync_run["generation_id"] == "sync_1"
    assert sync_run["status"] == "pending"
    assert sync_run["new_count"] == 0
    assert sync_run["changed_count"] == 0
    assert sync_run["failed_count"] == 0
    assert sync_run["completed_at"] is None


def test_diagnostic_fields_redact_sensitive_text(tmp_path: Path) -> None:
    repository = _repository(tmp_path)
    course = repository.get_or_create_course(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        canvas_user_id="67890",
    )

    material = repository.upsert_material_placeholder(
        course_id=course["id"],
        material_key="assignment:77",
        kind="assignment",
        error_message="Bearer token accidentally included",
    )
    sync_run = repository.create_sync_run_placeholder(
        course_id=course["id"],
        generation_id="sync_1",
        warnings_json='{"warning": "prompt text accidentally included"}',
    )

    assert material["error_message"] == "[diagnostic omitted]"
    assert sync_run["warnings_json"] == "[diagnostic omitted]"


def test_catalog_package_does_not_export_direct_connection_helper() -> None:
    assert "open_catalog_connection" not in catalog.__all__
    assert not hasattr(catalog, "open_catalog_connection")


def test_repository_uses_temp_sqlite_and_does_not_require_openai_api_key(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    repository = _repository(tmp_path)

    course = repository.get_or_create_course(
        canvas_origin="https://canvas.example.edu",
        course_id="12345",
        local_profile_id="profile_abc",
    )

    assert course["id"].startswith("course_")
    assert "backend/.data" not in str(repository.db_path)
    assert repository.db_path.is_file()


def _repository(
    tmp_path: Path,
    clock: MutableClock | None = None,
) -> CatalogRepository:
    return CatalogRepository(
        tmp_path / "private" / "catalog.sqlite3",
        now=clock,
    )
