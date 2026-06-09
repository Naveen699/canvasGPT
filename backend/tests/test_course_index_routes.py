import importlib
import sqlite3
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.openai_client import VectorStore


ENV_VARS = (
    "OPENAI_API_KEY",
    "OPENAI_RESPONSE_MODEL",
    "CANVASGPT_DB_PATH",
    "CANVASGPT_INDEX_RETENTION_DAYS",
    "CANVASGPT_MAX_FILE_BYTES",
    "CANVASGPT_LOG_LEVEL",
)


def test_prepare_rejects_missing_user_identity(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main, _db_path = _import_main(tmp_path, monkeypatch)

    with TestClient(main.app) as client:
        response = client.post(
            "/course-index/prepare",
            json={
                "canvasOrigin": "https://canvas.example.edu",
                "courseId": "12345",
                "manifest": {"materials": [], "placements": []},
            },
        )

    assert response.status_code == 422


def test_prepare_rejects_invalid_canvas_origin(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main, _db_path = _import_main(tmp_path, monkeypatch)

    with TestClient(main.app) as client:
        response = client.post(
            "/course-index/prepare",
            json={
                "canvasOrigin": "not an origin",
                "courseId": "12345",
                "canvasUserId": "67890",
                "manifest": {"materials": [], "placements": []},
            },
        )

    assert response.status_code == 422
    assert "canvas_origin" in response.json()["detail"]


def test_prepare_treats_native_canvas_materials_with_blank_content_type_as_eligible(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main, db_path = _import_main(tmp_path, monkeypatch, max_file_bytes=1)
    payload = {
        "canvasOrigin": "https://canvas.example.edu",
        "courseId": "12345",
        "localProfileId": "profile_abc",
        "manifest": {
            "materials": [
                {
                    "materialKey": "assignment:725371",
                    "kind": "assignment",
                    "title": "Homework #7",
                    "contentHash": "sha256:assignment",
                    "canvasUpdatedAt": "2026-03-02T05:01:14Z",
                    "size": 0,
                    "contentType": "",
                    "fileName": "",
                },
                {
                    "materialKey": "page:overview",
                    "kind": "page",
                    "title": "Overview",
                    "contentHash": "sha256:page",
                    "size": 0,
                    "contentType": "   ",
                },
            ],
            "placements": [],
        },
    }

    with TestClient(main.app) as client:
        response = client.post("/course-index/prepare", json=payload)

    assert response.status_code == 200
    data = response.json()
    assert data["syncPlan"] == {
        "newCount": 2,
        "changedCount": 0,
        "unchangedCount": 0,
        "staleCount": 0,
        "skippedCount": 0,
        "new": ["assignment:725371", "page:overview"],
        "changed": [],
        "unchanged": [],
        "stale": [],
        "skipped": [],
    }
    assert data["warnings"] == []

    with sqlite3.connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT material_key, status, error_type, content_type, file_name
            FROM materials
            ORDER BY material_key
            """
        ).fetchall()

    assert rows == [
        ("assignment:725371", "pending", None, None, None),
        ("page:overview", "pending", None, None, None),
    ]


def test_prepare_skips_actual_unsupported_files_with_structured_warning(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main, db_path = _import_main(tmp_path, monkeypatch)
    payload = {
        "canvasOrigin": "https://canvas.example.edu",
        "courseId": "12345",
        "localProfileId": "profile_abc",
        "manifest": {
            "materials": [
                {
                    "materialKey": "file:zip",
                    "kind": "file",
                    "title": "Archive",
                    "contentHash": "sha256:zip",
                    "size": 10,
                    "contentType": "application/zip",
                    "fileName": "archive.zip",
                    "supportedForIndexing": True,
                }
            ],
            "placements": [],
        },
    }

    with TestClient(main.app) as client:
        response = client.post("/course-index/prepare", json=payload)

    assert response.status_code == 200
    data = response.json()
    assert data["syncPlan"]["skippedCount"] == 1
    assert data["syncPlan"]["skipped"] == [
        {
            "materialKey": "file:zip",
            "title": "Archive",
            "reason": "unsupported_file_type",
            "message": (
                "Material content type or file extension is not supported for "
                "indexing."
            ),
        }
    ]
    assert data["warnings"] == data["syncPlan"]["skipped"]

    with sqlite3.connect(db_path) as connection:
        material = connection.execute(
            """
            SELECT status, error_type, error_message
            FROM materials
            WHERE material_key = 'file:zip'
            """
        ).fetchone()

    assert material == ("skipped", "unsupported_file_type", "[diagnostic omitted]")


def test_prepare_creates_course_plan_and_persists_metadata_only(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main, db_path = _import_main(tmp_path, monkeypatch, max_file_bytes=100)
    payload = {
        "canvasOrigin": "https://canvas.example.edu",
        "courseId": "12345",
        "courseName": "Biology 101",
        "canvasUserId": "67890",
        "manifest": {
            "materials": [
                {
                    "materialKey": "assignment:77",
                    "kind": "assignment",
                    "title": "Midterm Policy",
                    "canvasUrl": "https://canvas.example.edu/courses/12345/assignments/77",
                    "canvasUpdatedAt": "2026-05-31T10:00:00Z",
                    "contentHash": "sha256:assignment",
                    "size": 0,
                    "contentType": "text/html",
                    "body": "Canvas body that must not be stored",
                },
                {
                    "materialKey": "page:overview",
                    "kind": "page",
                    "title": "Course Overview",
                    "canvasUrl": "https://canvas.example.edu/courses/12345/pages/overview",
                    "size": 0,
                },
                {
                    "materialKey": "file:123",
                    "kind": "file",
                    "title": "Large video",
                    "canvasUrl": "https://canvas.example.edu/courses/12345/files/123",
                    "size": 101,
                    "contentType": "video/mp4",
                    "fileName": "lecture.mp4",
                    "fileDownloadUrl": "https://signed.example.invalid/secret",
                },
                {
                    "materialKey": "file:124",
                    "kind": "file",
                    "title": "Small video",
                    "canvasUrl": "https://canvas.example.edu/courses/12345/files/124",
                    "size": 10,
                    "contentType": "video/mp4",
                    "fileName": "clip.mp4",
                    "supportedForIndexing": True,
                },
                {
                    "materialKey": "canvas_url:https://canvas.example.edu/courses/12345/external_tools/1",
                    "kind": "canvas_url",
                    "title": "Unsupported tool",
                    "canvasUrl": "https://canvas.example.edu/courses/12345/external_tools/1",
                    "supportedForIndexing": False,
                },
            ],
            "placements": [
                {
                    "materialKey": "assignment:77",
                    "sourceKind": "module",
                    "moduleId": "456",
                    "moduleName": "Week 4",
                    "moduleItemId": "789",
                    "position": 3,
                    "label": "Week 4 Policy",
                }
            ],
            "collectionErrors": [{"name": "files", "message": "partial failure"}],
        },
    }

    with TestClient(main.app) as client:
        response = client.post("/course-index/prepare", json=payload)
        reuse_response = client.post("/course-index/prepare", json=payload)

    assert response.status_code == 200
    assert reuse_response.status_code == 200
    data = response.json()
    reused_data = reuse_response.json()
    assert data["courseIndexId"].startswith("course_")
    assert reused_data["courseIndexId"] == data["courseIndexId"]
    assert data["consentRequired"] is True
    assert data["consentGranted"] is False
    assert data["vectorStoreStatus"] == "not_created"
    assert data["syncPlan"] == {
        "newCount": 3,
        "changedCount": 0,
        "unchangedCount": 0,
        "staleCount": 0,
        "skippedCount": 2,
        "new": [
            "assignment:77",
            "page:overview",
            "canvas_url:https://canvas.example.edu/courses/12345/external_tools/1",
        ],
        "changed": [],
        "unchanged": [],
        "stale": [],
        "skipped": [
            {
                "materialKey": "file:123",
                "title": "Large video",
                "reason": "too_large",
                "message": "Material size exceeds the 100 byte limit.",
            },
            {
                "materialKey": "file:124",
                "title": "Small video",
                "reason": "unsupported_file_type",
                "message": "Material content type or file extension is not supported for indexing.",
            },
        ],
    }
    assert data["warnings"] == [
        {
            "materialKey": "file:123",
            "title": "Large video",
            "reason": "too_large",
            "message": "Material size exceeds the 100 byte limit.",
        },
        {
            "materialKey": "file:124",
            "title": "Small video",
            "reason": "unsupported_file_type",
            "message": "Material content type or file extension is not supported for indexing.",
        },
        {
            "materialKey": None,
            "title": None,
            "reason": "collection_error",
            "message": "files: partial failure",
        },
    ]
    assert reused_data["syncPlan"] == {
        "newCount": 0,
        "changedCount": 0,
        "unchangedCount": 3,
        "staleCount": 0,
        "skippedCount": 2,
        "new": [],
        "changed": [],
        "unchanged": [
            "assignment:77",
            "page:overview",
            "canvas_url:https://canvas.example.edu/courses/12345/external_tools/1",
        ],
        "stale": [],
        "skipped": [
            {
                "materialKey": "file:123",
                "title": "Large video",
                "reason": "too_large",
                "message": "Material size exceeds the 100 byte limit.",
            },
            {
                "materialKey": "file:124",
                "title": "Small video",
                "reason": "unsupported_file_type",
                "message": "Material content type or file extension is not supported for indexing.",
            },
        ],
    }

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        courses = connection.execute("SELECT * FROM courses").fetchall()
        materials = {
            row["material_key"]: dict(row)
            for row in connection.execute("SELECT * FROM materials").fetchall()
        }
        placements = [
            dict(row)
            for row in connection.execute("SELECT * FROM material_placements").fetchall()
        ]

    assert len(courses) == 1
    assert dict(courses[0])["vector_store_id"] is None
    assert materials["assignment:77"]["status"] == "pending"
    assert materials["assignment:77"]["content_hash"] == "sha256:assignment"
    assert materials["page:overview"]["status"] == "pending"
    assert materials["file:123"]["status"] == "skipped"
    assert materials["file:123"]["error_type"] == "too_large"
    assert materials["file:123"]["error_message"] == "[diagnostic omitted]"
    assert materials["file:124"]["status"] == "skipped"
    assert materials["file:124"]["error_type"] == "unsupported_file_type"
    assert materials["file:124"]["error_message"] == "[diagnostic omitted]"
    assert (
        materials[
            "canvas_url:https://canvas.example.edu/courses/12345/external_tools/1"
        ]["status"]
        == "pending"
    )
    assert placements == [
        {
            "id": placements[0]["id"],
            "course_id": data["courseIndexId"],
            "material_key": "assignment:77",
            "source_kind": "module",
            "module_id": "456",
            "module_name": "Week 4",
            "module_item_id": "789",
            "position": 3,
            "label": "Week 4 Policy",
            "created_at": placements[0]["created_at"],
        }
    ]
    assert "Canvas body that must not be stored" not in str(materials)
    assert "https://signed.example.invalid/secret" not in str(materials)


def test_prepare_reports_new_changed_unchanged_and_stale_before_upsert(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main, _db_path = _import_main(tmp_path, monkeypatch)
    initial_payload = {
        "canvasOrigin": "https://canvas.example.edu",
        "courseId": "12345",
        "localProfileId": "profile_abc",
        "manifest": {
            "materials": [
                {
                    "materialKey": "assignment:changed-hash",
                    "kind": "assignment",
                    "contentHash": "sha256:old",
                },
                {
                    "materialKey": "page:changed-updated",
                    "kind": "page",
                    "contentHash": "sha256:stable",
                    "canvasUpdatedAt": "2026-06-01T10:00:00Z",
                },
                {
                    "materialKey": "page:unchanged",
                    "kind": "page",
                    "contentHash": "sha256:stable",
                },
                {
                    "materialKey": "assignment:stale",
                    "kind": "assignment",
                    "contentHash": "sha256:stale",
                },
            ],
            "placements": [],
        },
    }
    next_payload = {
        "canvasOrigin": "https://canvas.example.edu",
        "courseId": "12345",
        "localProfileId": "profile_abc",
        "manifest": {
            "materials": [
                {
                    "materialKey": "assignment:changed-hash",
                    "kind": "assignment",
                    "contentHash": "sha256:new",
                },
                {
                    "materialKey": "page:changed-updated",
                    "kind": "page",
                    "contentHash": "sha256:stable",
                    "canvasUpdatedAt": "2026-06-02T10:00:00Z",
                },
                {
                    "materialKey": "page:unchanged",
                    "kind": "page",
                    "contentHash": "sha256:stable",
                },
                {
                    "materialKey": "assignment:new",
                    "kind": "assignment",
                    "contentHash": "sha256:new-assignment",
                }
            ],
            "placements": [],
        },
    }

    with TestClient(main.app) as client:
        assert client.post("/course-index/prepare", json=initial_payload).status_code == 200
        response = client.post("/course-index/prepare", json=next_payload)

    assert response.status_code == 200
    assert response.json()["syncPlan"] == {
        "newCount": 1,
        "changedCount": 2,
        "unchangedCount": 1,
        "staleCount": 1,
        "skippedCount": 0,
        "new": ["assignment:new"],
        "changed": ["assignment:changed-hash", "page:changed-updated"],
        "unchanged": ["page:unchanged"],
        "stale": ["assignment:stale"],
        "skipped": [],
    }


def test_prepare_ignores_duplicate_manifest_material_without_overwriting_first(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main, db_path = _import_main(tmp_path, monkeypatch)
    payload = {
        "canvasOrigin": "https://canvas.example.edu",
        "courseId": "12345",
        "localProfileId": "profile_abc",
        "manifest": {
            "materials": [
                {
                    "materialKey": "page:overview",
                    "kind": "page",
                    "title": "First overview",
                    "contentHash": "sha256:first",
                },
                {
                    "materialKey": "page:overview",
                    "kind": "page",
                    "title": "Duplicate overview",
                    "contentHash": "sha256:duplicate",
                },
            ],
            "placements": [],
        },
    }

    with TestClient(main.app) as client:
        response = client.post("/course-index/prepare", json=payload)

    assert response.status_code == 200
    assert response.json()["syncPlan"] == {
        "newCount": 1,
        "changedCount": 0,
        "unchangedCount": 0,
        "staleCount": 0,
        "skippedCount": 0,
        "new": ["page:overview"],
        "changed": [],
        "unchanged": [],
        "stale": [],
        "skipped": [],
    }

    with sqlite3.connect(db_path) as connection:
        material = connection.execute(
            """
            SELECT title, content_hash, status
            FROM materials
            WHERE material_key = 'page:overview'
            """
        ).fetchone()

    assert material == ("First overview", "sha256:first", "pending")


def test_repeated_prepare_reuses_rows_and_does_not_rewrite_unchanged_materials(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main, db_path = _import_main(tmp_path, monkeypatch)
    payload = {
        "canvasOrigin": "https://canvas.example.edu",
        "courseId": "12345",
        "localProfileId": "profile_abc",
        "manifest": {
            "materials": [
                {
                    "materialKey": "assignment:stable",
                    "kind": "assignment",
                    "title": "Stable Assignment",
                    "contentHash": "sha256:stable",
                    "canvasUpdatedAt": "2026-06-01T10:00:00Z",
                }
            ],
            "placements": [
                {
                    "materialKey": "assignment:stable",
                    "sourceKind": "module",
                    "moduleId": "module_1",
                    "position": 1,
                }
            ],
        },
    }

    with TestClient(main.app) as client:
        first_response = client.post("/course-index/prepare", json=payload)
        course_index_id = first_response.json()["courseIndexId"]

        with sqlite3.connect(db_path) as connection:
            first_material = connection.execute(
                """
                SELECT id, created_at, updated_at
                FROM materials
                WHERE course_id = ? AND material_key = 'assignment:stable'
                """,
                (course_index_id,),
            ).fetchone()
            connection.execute(
                """
                UPDATE materials
                SET updated_at = '2026-06-09T00:00:00+00:00'
                WHERE course_id = ? AND material_key = 'assignment:stable'
                """,
                (course_index_id,),
            )

        second_response = client.post("/course-index/prepare", json=payload)

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert second_response.json()["courseIndexId"] == course_index_id
    assert second_response.json()["syncPlan"] == {
        "newCount": 0,
        "changedCount": 0,
        "unchangedCount": 1,
        "staleCount": 0,
        "skippedCount": 0,
        "new": [],
        "changed": [],
        "unchanged": ["assignment:stable"],
        "stale": [],
        "skipped": [],
    }

    with sqlite3.connect(db_path) as connection:
        course_count = connection.execute("SELECT COUNT(*) FROM courses").fetchone()[0]
        material_count = connection.execute(
            "SELECT COUNT(*) FROM materials WHERE course_id = ?",
            (course_index_id,),
        ).fetchone()[0]
        second_material = connection.execute(
            """
            SELECT id, created_at, updated_at
            FROM materials
            WHERE course_id = ? AND material_key = 'assignment:stable'
            """,
            (course_index_id,),
        ).fetchone()

    assert course_count == 1
    assert material_count == 1
    assert first_material is not None
    assert second_material == (
        first_material[0],
        first_material[1],
        "2026-06-09T00:00:00+00:00",
    )


def test_prepare_repairs_legacy_skipped_native_material_without_marker_change(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main, db_path = _import_main(tmp_path, monkeypatch)
    payload = {
        "canvasOrigin": "https://canvas.example.edu",
        "courseId": "12345",
        "localProfileId": "profile_abc",
        "manifest": {
            "materials": [
                {
                    "materialKey": "assignment:legacy",
                    "kind": "assignment",
                    "title": "Legacy Assignment",
                    "contentHash": "sha256:stable",
                    "canvasUpdatedAt": "2026-06-01T10:00:00Z",
                    "contentType": "",
                    "fileName": "",
                    "size": 0,
                }
            ],
            "placements": [],
        },
    }

    with TestClient(main.app) as client:
        first_response = client.post("/course-index/prepare", json=payload)
        course_index_id = first_response.json()["courseIndexId"]
        with sqlite3.connect(db_path) as connection:
            connection.execute(
                """
                UPDATE materials
                SET
                    status = 'skipped',
                    error_type = 'unsupported_file_type',
                    error_message = '[diagnostic omitted]',
                    updated_at = '2026-06-09T00:00:00+00:00'
                WHERE course_id = ? AND material_key = 'assignment:legacy'
                """,
                (course_index_id,),
            )

        second_response = client.post("/course-index/prepare", json=payload)

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert second_response.json()["syncPlan"] == {
        "newCount": 0,
        "changedCount": 0,
        "unchangedCount": 1,
        "staleCount": 0,
        "skippedCount": 0,
        "new": [],
        "changed": [],
        "unchanged": ["assignment:legacy"],
        "stale": [],
        "skipped": [],
    }

    with sqlite3.connect(db_path) as connection:
        material = connection.execute(
            """
            SELECT status, error_type, error_message, content_type, file_name
            FROM materials
            WHERE course_id = ? AND material_key = 'assignment:legacy'
            """,
            (course_index_id,),
        ).fetchone()

    assert material == ("pending", None, None, None, None)


def test_consent_updates_existing_course_index(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main, db_path = _import_main(tmp_path, monkeypatch)

    with TestClient(main.app) as client:
        prepare_response = client.post(
            "/course-index/prepare",
            json={
                "canvasOrigin": "https://canvas.example.edu",
                "courseId": "12345",
                "localProfileId": "profile_abc",
                "manifest": {"materials": [], "placements": []},
            },
        )
        course_index_id = prepare_response.json()["courseIndexId"]
        consent_response = client.post(
            "/course-index/consent",
            json={"courseIndexId": course_index_id, "granted": True},
        )
        already_consented_response = client.post(
            "/course-index/prepare",
            json={
                "canvasOrigin": "https://canvas.example.edu",
                "courseId": "12345",
                "localProfileId": "profile_abc",
                "manifest": {"materials": [], "placements": []},
            },
        )

    assert consent_response.status_code == 200
    assert consent_response.json() == {
        "courseIndexId": course_index_id,
        "consentGranted": True,
    }
    assert already_consented_response.status_code == 200
    assert already_consented_response.json()["courseIndexId"] == course_index_id
    assert already_consented_response.json()["consentGranted"] is True

    with sqlite3.connect(db_path) as connection:
        consent_granted = connection.execute(
            "SELECT consent_granted FROM courses WHERE id = ?",
            (course_index_id,),
        ).fetchone()[0]

    assert consent_granted == 1


def test_consent_revocation_keeps_vector_store_status_not_created(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main, db_path = _import_main(tmp_path, monkeypatch)

    with TestClient(main.app) as client:
        prepare_response = client.post(
            "/course-index/prepare",
            json={
                "canvasOrigin": "https://canvas.example.edu",
                "courseId": "12345",
                "localProfileId": "profile_abc",
                "manifest": {"materials": [], "placements": []},
            },
        )
        course_index_id = prepare_response.json()["courseIndexId"]

        grant_response = client.post(
            "/course-index/consent",
            json={"courseIndexId": course_index_id, "granted": True},
        )
        with sqlite3.connect(db_path) as connection:
            connection.execute(
                """
                UPDATE courses
                SET vector_store_id = ?, sync_status = ?
                WHERE id = ?
                """,
                ("vs_ready", "ready", course_index_id),
            )
        revoke_response = client.post(
            "/course-index/consent",
            json={"courseIndexId": course_index_id, "granted": False},
        )
        prepare_after_revoke_response = client.post(
            "/course-index/prepare",
            json={
                "canvasOrigin": "https://canvas.example.edu",
                "courseId": "12345",
                "localProfileId": "profile_abc",
                "manifest": {"materials": [], "placements": []},
            },
        )

    assert grant_response.status_code == 200
    assert revoke_response.status_code == 200
    assert revoke_response.json() == {
        "courseIndexId": course_index_id,
        "consentGranted": False,
    }
    assert prepare_after_revoke_response.status_code == 200
    assert prepare_after_revoke_response.json()["consentGranted"] is False
    assert prepare_after_revoke_response.json()["vectorStoreStatus"] == "not_created"

    with sqlite3.connect(db_path) as connection:
        course = connection.execute(
            """
            SELECT consent_granted, vector_store_id, sync_status
            FROM courses
            WHERE id = ?
            """,
            (course_index_id,),
        ).fetchone()

    assert course == (0, "vs_ready", "ready")


def test_consent_returns_not_found_for_unknown_course_index(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main, _db_path = _import_main(tmp_path, monkeypatch)

    with TestClient(main.app) as client:
        response = client.post(
            "/course-index/consent",
            json={"courseIndexId": "course_missing", "granted": True},
        )

    assert response.status_code == 404


def test_vector_store_endpoint_grants_consent_and_creates_vector_store(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main, db_path = _import_main(tmp_path, monkeypatch)
    fake_openai = RouteFakeOpenAIClient()

    with TestClient(main.app) as client:
        main.app.state.openai_client_factory = lambda _config: fake_openai
        prepare_response = client.post(
            "/course-index/prepare",
            json={
                "canvasOrigin": "https://student.canvas.example.edu",
                "courseId": "biology-101",
                "courseName": "Biology 101",
                "canvasUserId": "student@example.edu",
                "manifest": {"materials": [], "placements": []},
            },
        )
        course_index_id = prepare_response.json()["courseIndexId"]
        vector_store_response = client.post(
            "/course-index/vector-store",
            json={"courseIndexId": course_index_id, "consentGranted": True},
        )

    assert vector_store_response.status_code == 200
    assert vector_store_response.json()["courseIndexId"] == course_index_id
    assert vector_store_response.json()["vectorStoreId"] == "vs_route_created"
    assert vector_store_response.json()["vectorStoreStatus"] == "pending"
    assert vector_store_response.json()["action"] == "created"
    assert fake_openai.create_vector_store_calls == [
        {
            "name": fake_openai.create_vector_store_calls[0]["name"],
            "expires_after_days": 7,
            "metadata": {"course_index_id": course_index_id},
        }
    ]
    created_name = fake_openai.create_vector_store_calls[0]["name"]
    assert "student.canvas.example.edu" not in created_name
    assert "student@example.edu" not in created_name
    assert "Biology 101" not in created_name

    with sqlite3.connect(db_path) as connection:
        course = connection.execute(
            """
            SELECT consent_granted, vector_store_id, sync_status, expires_at, last_active_at
            FROM courses
            WHERE id = ?
            """,
            (course_index_id,),
        ).fetchone()

    assert course[0] == 1
    assert course[1] == "vs_route_created"
    assert course[2] == "pending"
    assert course[3] is not None
    assert course[4] is not None


def test_vector_store_endpoint_reuses_existing_vector_store_without_openai_create(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main, db_path = _import_main(tmp_path, monkeypatch)
    fake_openai = RouteFakeOpenAIClient()

    with TestClient(main.app) as client:
        main.app.state.openai_client_factory = lambda _config: fake_openai
        prepare_response = client.post(
            "/course-index/prepare",
            json={
                "canvasOrigin": "https://canvas.example.edu",
                "courseId": "12345",
                "localProfileId": "profile_abc",
                "manifest": {"materials": [], "placements": []},
            },
        )
        course_index_id = prepare_response.json()["courseIndexId"]
        client.post(
            "/course-index/consent",
            json={"courseIndexId": course_index_id, "granted": True},
        )
        with sqlite3.connect(db_path) as connection:
            connection.execute(
                """
                UPDATE courses
                SET vector_store_id = ?, sync_status = ?, expires_at = ?
                WHERE id = ?
                """,
                (
                    "vs_existing",
                    "ready",
                    "2026-06-16T12:00:00+00:00",
                    course_index_id,
                ),
            )
        vector_store_response = client.post(
            "/course-index/vector-store",
            json={"courseIndexId": course_index_id},
        )

    assert vector_store_response.status_code == 200
    assert vector_store_response.json()["vectorStoreId"] == "vs_existing"
    assert vector_store_response.json()["vectorStoreStatus"] == "ready"
    assert vector_store_response.json()["action"] == "reused"
    assert fake_openai.create_vector_store_calls == []


def test_vector_store_endpoint_denies_missing_consent_without_openai_create(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main, _db_path = _import_main(tmp_path, monkeypatch)
    fake_openai = RouteFakeOpenAIClient()

    with TestClient(main.app) as client:
        main.app.state.openai_client_factory = lambda _config: fake_openai
        prepare_response = client.post(
            "/course-index/prepare",
            json={
                "canvasOrigin": "https://canvas.example.edu",
                "courseId": "12345",
                "localProfileId": "profile_abc",
                "manifest": {"materials": [], "placements": []},
            },
        )
        course_index_id = prepare_response.json()["courseIndexId"]
        vector_store_response = client.post(
            "/course-index/vector-store",
            json={"courseIndexId": course_index_id},
        )

    assert vector_store_response.status_code == 409
    assert "consent" in vector_store_response.json()["detail"]
    assert fake_openai.create_vector_store_calls == []


class RouteFakeOpenAIClient:
    def __init__(self) -> None:
        self.create_vector_store_calls: list[dict[str, object]] = []

    def create_vector_store(
        self,
        name: str,
        expires_after_days: int,
        metadata: dict[str, str],
    ) -> VectorStore:
        self.create_vector_store_calls.append(
            {
                "name": name,
                "expires_after_days": expires_after_days,
                "metadata": dict(metadata),
            }
        )
        return VectorStore(id="vs_route_created", name=name, status="in_progress")


def _import_main(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    max_file_bytes: int | None = None,
):
    for name in ENV_VARS:
        monkeypatch.delenv(name, raising=False)

    db_path = tmp_path / "private" / "canvasgpt.sqlite3"
    monkeypatch.setenv("CANVASGPT_DB_PATH", str(db_path))
    if max_file_bytes is not None:
        monkeypatch.setenv("CANVASGPT_MAX_FILE_BYTES", str(max_file_bytes))

    sys.modules.pop("backend.main", None)
    return importlib.import_module("backend.main"), db_path
