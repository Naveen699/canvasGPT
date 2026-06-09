import importlib
import sqlite3
import stat
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.catalog.schema import STAGE_1_TABLES, SchemaError, initialize_schema


EXPECTED_COLUMNS = {
    "courses": [
        "id",
        "canvas_origin",
        "course_id",
        "course_name",
        "canvas_user_id",
        "local_profile_id",
        "hosted_user_id",
        "auth_subject",
        "course_key_hash",
        "vector_store_id",
        "active_generation_id",
        "consent_granted",
        "sync_status",
        "last_synced_at",
        "last_active_at",
        "expires_at",
        "created_at",
        "updated_at",
    ],
    "materials": [
        "id",
        "course_id",
        "material_key",
        "kind",
        "title",
        "canvas_url",
        "canvas_updated_at",
        "content_hash",
        "size",
        "content_type",
        "file_name",
        "openai_file_id",
        "vector_store_file_id",
        "generation_id",
        "status",
        "error_type",
        "error_message",
        "created_at",
        "updated_at",
    ],
    "material_placements": [
        "id",
        "course_id",
        "material_key",
        "source_kind",
        "module_id",
        "module_name",
        "module_item_id",
        "position",
        "label",
        "created_at",
    ],
    "sync_runs": [
        "id",
        "course_id",
        "generation_id",
        "status",
        "new_count",
        "changed_count",
        "unchanged_count",
        "indexed_count",
        "pending_count",
        "skipped_count",
        "failed_count",
        "warnings_json",
        "started_at",
        "completed_at",
    ],
}


PROHIBITED_STORAGE_TERMS = (
    "body",
    "bytes",
    "cookie",
    "token",
    "prompt",
    "embedding",
)


def test_initialize_schema_creates_parent_directory_db_and_tables(tmp_path: Path) -> None:
    db_path = tmp_path / "missing" / "nested" / "canvasgpt.sqlite3"

    initialize_schema(db_path)

    assert db_path.is_file()
    with sqlite3.connect(db_path) as connection:
        tables = _table_names(connection)

    assert set(STAGE_1_TABLES).issubset(tables)


def test_initialize_schema_is_idempotent(tmp_path: Path) -> None:
    db_path = tmp_path / "private" / "canvasgpt.sqlite3"

    initialize_schema(db_path)
    initialize_schema(db_path)

    with sqlite3.connect(db_path) as connection:
        assert set(STAGE_1_TABLES).issubset(_table_names(connection))


def test_schema_columns_match_prd_and_exclude_raw_sensitive_storage(tmp_path: Path) -> None:
    db_path = tmp_path / "private" / "canvasgpt.sqlite3"
    initialize_schema(db_path)

    with sqlite3.connect(db_path) as connection:
        for table_name, expected_columns in EXPECTED_COLUMNS.items():
            actual_columns = _column_names(connection, table_name)
            assert actual_columns == expected_columns

            lowered_columns = " ".join(actual_columns).lower()
            for prohibited_term in PROHIBITED_STORAGE_TERMS:
                assert prohibited_term not in lowered_columns


def test_required_unique_constraints_exist(tmp_path: Path) -> None:
    db_path = tmp_path / "private" / "canvasgpt.sqlite3"
    initialize_schema(db_path)

    with sqlite3.connect(db_path) as connection:
        assert _has_unique_index(connection, "courses", ["course_key_hash"])
        assert _has_unique_index(connection, "materials", ["course_id", "material_key"])


def test_initialize_schema_restricts_db_directory_and_file_permissions(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "private" / "nested" / "canvasgpt.sqlite3"

    initialize_schema(db_path)

    assert stat.S_IMODE(db_path.parent.parent.stat().st_mode) == 0o700
    assert stat.S_IMODE(db_path.parent.stat().st_mode) == 0o700
    assert stat.S_IMODE(db_path.stat().st_mode) == 0o600


def test_initialize_schema_rejects_symlink_db_file(tmp_path: Path) -> None:
    target_path = tmp_path / "target.sqlite3"
    symlink_path = tmp_path / "linked.sqlite3"
    symlink_path.symlink_to(target_path)

    with pytest.raises(SchemaError, match="must not contain symlinks"):
        initialize_schema(symlink_path)


def test_initialize_schema_rejects_symlink_parent_directory(tmp_path: Path) -> None:
    real_dir = tmp_path / "real"
    real_dir.mkdir()
    symlink_dir = tmp_path / "linked-dir"
    symlink_dir.symlink_to(real_dir, target_is_directory=True)

    with pytest.raises(SchemaError, match="must not contain symlinks"):
        initialize_schema(symlink_dir / "canvasgpt.sqlite3")


def test_initialize_schema_rejects_permissive_existing_parent_directory(
    tmp_path: Path,
) -> None:
    db_dir = tmp_path / "permissive"
    db_dir.mkdir(mode=0o755)

    with pytest.raises(SchemaError, match="group- or world-accessible"):
        initialize_schema(db_dir / "canvasgpt.sqlite3")


def test_initialize_schema_rejects_permissive_existing_db_file(tmp_path: Path) -> None:
    db_dir = tmp_path / "private"
    db_dir.mkdir(mode=0o700)
    db_path = db_dir / "canvasgpt.sqlite3"
    db_path.touch(mode=0o644)

    with pytest.raises(SchemaError, match="Database file must not be group- or world-accessible"):
        initialize_schema(db_path)


def test_initialize_schema_rejects_existing_non_sqlite_file(tmp_path: Path) -> None:
    db_dir = tmp_path / "private"
    db_dir.mkdir(mode=0o700)
    db_path = db_dir / "canvasgpt.sqlite3"
    db_path.write_text("not sqlite", encoding="utf-8")
    db_path.chmod(0o600)

    with pytest.raises(SchemaError, match="not a SQLite database"):
        initialize_schema(db_path)


def test_backend_startup_creates_configured_sqlite_file(
    tmp_path: Path,
    monkeypatch,
) -> None:
    db_path = tmp_path / "startup" / "canvasgpt.sqlite3"
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("CANVASGPT_DB_PATH", str(db_path))

    sys.modules.pop("backend.main", None)
    main = importlib.import_module("backend.main")

    with TestClient(main.app):
        assert main.app.state.config.openai_api_key is None
        assert db_path.is_file()

    with sqlite3.connect(db_path) as connection:
        assert set(STAGE_1_TABLES).issubset(_table_names(connection))


def _table_names(connection: sqlite3.Connection) -> set[str]:
    cursor = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
    )
    return {row[0] for row in cursor.fetchall()}


def _column_names(connection: sqlite3.Connection, table_name: str) -> list[str]:
    cursor = connection.execute(f"PRAGMA table_info({table_name})")
    return [row[1] for row in cursor.fetchall()]


def _has_unique_index(
    connection: sqlite3.Connection,
    table_name: str,
    expected_columns: list[str],
) -> bool:
    index_cursor = connection.execute(f"PRAGMA index_list({table_name})")
    for index_row in index_cursor.fetchall():
        is_unique = bool(index_row[2])
        index_name = index_row[1]
        if not is_unique:
            continue

        column_cursor = connection.execute(f"PRAGMA index_info({index_name})")
        indexed_columns = [row[2] for row in column_cursor.fetchall()]
        if indexed_columns == expected_columns:
            return True

    return False
