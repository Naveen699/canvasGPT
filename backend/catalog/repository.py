import sqlite3
import uuid
from collections.abc import Callable, Iterator, Mapping, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from backend.catalog.identity import build_course_identity
from backend.catalog.schema import initialize_schema


CatalogRow = dict[str, Any]
DIAGNOSTIC_PLACEHOLDER = "[diagnostic omitted]"


class CatalogRepository:
    def __init__(
        self,
        db_path: str | Path,
        *,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self.db_path = Path(db_path).expanduser().absolute()
        self._now = now or (lambda: datetime.now(UTC))
        initialize_schema(self.db_path)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        with _open_catalog_connection(self.db_path, initialize=False) as connection:
            yield connection

    def get_course_by_id(self, course_id: str) -> CatalogRow | None:
        with self.connect() as connection:
            cursor = connection.execute(
                "SELECT * FROM courses WHERE id = ?",
                (course_id,),
            )
            return _row_to_dict(cursor.fetchone())

    def get_course_by_identity(
        self,
        *,
        canvas_origin: str,
        course_id: str,
        canvas_user_id: str | None = None,
        local_profile_id: str | None = None,
    ) -> CatalogRow | None:
        identity = build_course_identity(
            canvas_origin=canvas_origin,
            course_id=course_id,
            canvas_user_id=canvas_user_id,
            local_profile_id=local_profile_id,
        )

        with self.connect() as connection:
            cursor = connection.execute(
                "SELECT * FROM courses WHERE course_key_hash = ?",
                (identity.course_key_hash,),
            )
            return _row_to_dict(cursor.fetchone())

    def get_or_create_course(
        self,
        *,
        canvas_origin: str,
        course_id: str,
        course_name: str | None = None,
        canvas_user_id: str | None = None,
        local_profile_id: str | None = None,
    ) -> CatalogRow:
        identity = build_course_identity(
            canvas_origin=canvas_origin,
            course_id=course_id,
            canvas_user_id=canvas_user_id,
            local_profile_id=local_profile_id,
        )
        timestamp = self._timestamp()
        normalized_course_name = _optional_text(course_name)
        normalized_canvas_user_id = _optional_text(canvas_user_id)
        normalized_local_profile_id = (
            None if normalized_canvas_user_id is not None else _optional_text(local_profile_id)
        )

        with self.connect() as connection:
            course_id_value = _new_id("course")
            connection.execute(
                """
                INSERT INTO courses (
                    id,
                    canvas_origin,
                    course_id,
                    course_name,
                    canvas_user_id,
                    local_profile_id,
                    hosted_user_id,
                    auth_subject,
                    course_key_hash,
                    last_active_at,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)
                ON CONFLICT(course_key_hash) DO UPDATE SET
                    course_name = excluded.course_name,
                    last_active_at = excluded.last_active_at,
                    updated_at = excluded.updated_at
                """,
                (
                    course_id_value,
                    identity.canvas_origin,
                    identity.course_id,
                    normalized_course_name,
                    normalized_canvas_user_id,
                    normalized_local_profile_id,
                    identity.course_key_hash,
                    timestamp,
                    timestamp,
                    timestamp,
                ),
            )
            return _select_course_by_hash(connection, identity.course_key_hash)

    def list_materials_by_course(self, *, course_id: str) -> list[CatalogRow]:
        with self.connect() as connection:
            cursor = connection.execute(
                """
                SELECT *
                FROM materials
                WHERE course_id = ?
                ORDER BY material_key
                """,
                (course_id,),
            )
            return [_row_to_dict(row) for row in cursor.fetchall()]

    def upsert_material_placeholder(
        self,
        *,
        course_id: str,
        material_key: str,
        kind: str,
        title: str | None = None,
        canvas_url: str | None = None,
        canvas_updated_at: str | None = None,
        content_hash: str | None = None,
        size: int | None = None,
        content_type: str | None = None,
        file_name: str | None = None,
        openai_file_id: str | None = None,
        vector_store_file_id: str | None = None,
        generation_id: str | None = None,
        status: str = "pending",
        error_type: str | None = None,
        error_message: str | None = None,
    ) -> CatalogRow:
        timestamp = self._timestamp()

        with self.connect() as connection:
            cursor = connection.execute(
                """
                SELECT id, created_at
                FROM materials
                WHERE course_id = ? AND material_key = ?
                """,
                (course_id, material_key),
            )
            existing_material = _row_to_dict(cursor.fetchone())
            material_id = (
                existing_material["id"]
                if existing_material is not None
                else _new_id("material")
            )
            created_at = (
                existing_material["created_at"]
                if existing_material is not None
                else timestamp
            )

            connection.execute(
                """
                INSERT INTO materials (
                    id,
                    course_id,
                    material_key,
                    kind,
                    title,
                    canvas_url,
                    canvas_updated_at,
                    content_hash,
                    size,
                    content_type,
                    file_name,
                    openai_file_id,
                    vector_store_file_id,
                    generation_id,
                    status,
                    error_type,
                    error_message,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(course_id, material_key) DO UPDATE SET
                    kind = excluded.kind,
                    title = excluded.title,
                    canvas_url = excluded.canvas_url,
                    canvas_updated_at = excluded.canvas_updated_at,
                    content_hash = excluded.content_hash,
                    size = excluded.size,
                    content_type = excluded.content_type,
                    file_name = excluded.file_name,
                    openai_file_id = excluded.openai_file_id,
                    vector_store_file_id = excluded.vector_store_file_id,
                    generation_id = excluded.generation_id,
                    status = excluded.status,
                    error_type = excluded.error_type,
                    error_message = excluded.error_message,
                    updated_at = excluded.updated_at
                """,
                (
                    material_id,
                    course_id,
                    material_key,
                    kind,
                    _optional_text(title),
                    _optional_text(canvas_url),
                    _optional_text(canvas_updated_at),
                    _optional_text(content_hash),
                    size,
                    _optional_text(content_type),
                    _optional_text(file_name),
                    _optional_text(openai_file_id),
                    _optional_text(vector_store_file_id),
                    _optional_text(generation_id),
                    status,
                    _optional_text(error_type),
                    _safe_diagnostic_text(error_message),
                    created_at,
                    timestamp,
                ),
            )
            cursor = connection.execute(
                "SELECT * FROM materials WHERE course_id = ? AND material_key = ?",
                (course_id, material_key),
            )
            return _row_to_dict(cursor.fetchone())

    def upsert_manifest_material_metadata(
        self,
        *,
        course_id: str,
        material_key: str,
        kind: str,
        title: str | None = None,
        canvas_url: str | None = None,
        canvas_updated_at: str | None = None,
        content_hash: str | None = None,
        size: int | None = None,
        content_type: str | None = None,
        file_name: str | None = None,
        generation_id: str | None = None,
        status: str = "pending",
        error_type: str | None = None,
        error_message: str | None = None,
    ) -> CatalogRow:
        timestamp = self._timestamp()

        with self.connect() as connection:
            cursor = connection.execute(
                """
                SELECT id, created_at
                FROM materials
                WHERE course_id = ? AND material_key = ?
                """,
                (course_id, material_key),
            )
            existing_material = _row_to_dict(cursor.fetchone())
            material_id = (
                existing_material["id"]
                if existing_material is not None
                else _new_id("material")
            )
            created_at = (
                existing_material["created_at"]
                if existing_material is not None
                else timestamp
            )

            connection.execute(
                """
                INSERT INTO materials (
                    id,
                    course_id,
                    material_key,
                    kind,
                    title,
                    canvas_url,
                    canvas_updated_at,
                    content_hash,
                    size,
                    content_type,
                    file_name,
                    generation_id,
                    status,
                    error_type,
                    error_message,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(course_id, material_key) DO UPDATE SET
                    kind = excluded.kind,
                    title = excluded.title,
                    canvas_url = excluded.canvas_url,
                    canvas_updated_at = excluded.canvas_updated_at,
                    content_hash = excluded.content_hash,
                    size = excluded.size,
                    content_type = excluded.content_type,
                    file_name = excluded.file_name,
                    generation_id = excluded.generation_id,
                    status = excluded.status,
                    error_type = excluded.error_type,
                    error_message = excluded.error_message,
                    updated_at = excluded.updated_at
                """,
                (
                    material_id,
                    course_id,
                    material_key,
                    kind,
                    _optional_text(title),
                    _optional_text(canvas_url),
                    _optional_text(canvas_updated_at),
                    _optional_text(content_hash),
                    size,
                    _optional_text(content_type),
                    _optional_text(file_name),
                    _optional_text(generation_id),
                    status,
                    _optional_text(error_type),
                    _safe_diagnostic_text(error_message),
                    created_at,
                    timestamp,
                ),
            )
            cursor = connection.execute(
                "SELECT * FROM materials WHERE course_id = ? AND material_key = ?",
                (course_id, material_key),
            )
            return _row_to_dict(cursor.fetchone())

    def replace_material_placements(
        self,
        *,
        course_id: str,
        material_key: str,
        placements: Sequence[Mapping[str, Any]],
    ) -> list[CatalogRow]:
        timestamp = self._timestamp()

        with self.connect() as connection:
            connection.execute(
                "DELETE FROM material_placements WHERE course_id = ? AND material_key = ?",
                (course_id, material_key),
            )
            for placement in placements:
                connection.execute(
                    """
                    INSERT INTO material_placements (
                        id,
                        course_id,
                        material_key,
                        source_kind,
                        module_id,
                        module_name,
                        module_item_id,
                        position,
                        label,
                        created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        _new_id("placement"),
                        course_id,
                        material_key,
                        _optional_text(placement.get("source_kind")),
                        _optional_text(placement.get("module_id")),
                        _optional_text(placement.get("module_name")),
                        _optional_text(placement.get("module_item_id")),
                        placement.get("position"),
                        _optional_text(placement.get("label")),
                        timestamp,
                    ),
                )

            cursor = connection.execute(
                """
                SELECT *
                FROM material_placements
                WHERE course_id = ? AND material_key = ?
                ORDER BY position, id
                """,
                (course_id, material_key),
            )
            return [_row_to_dict(row) for row in cursor.fetchall()]

    def replace_placements_for_manifest_materials(
        self,
        *,
        course_id: str,
        placements_by_material_key: Mapping[str, Sequence[Mapping[str, Any]]],
    ) -> dict[str, list[CatalogRow]]:
        timestamp = self._timestamp()
        material_keys = list(dict.fromkeys(placements_by_material_key.keys()))
        if not material_keys:
            return {}

        with self.connect() as connection:
            replaced_placements: dict[str, list[CatalogRow]] = {}
            for material_key in material_keys:
                connection.execute(
                    """
                    DELETE FROM material_placements
                    WHERE course_id = ? AND material_key = ?
                    """,
                    (course_id, material_key),
                )
                for placement in placements_by_material_key[material_key]:
                    connection.execute(
                        """
                        INSERT INTO material_placements (
                            id,
                            course_id,
                            material_key,
                            source_kind,
                            module_id,
                            module_name,
                            module_item_id,
                            position,
                            label,
                            created_at
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            _new_id("placement"),
                            course_id,
                            material_key,
                            _optional_text(placement.get("source_kind")),
                            _optional_text(placement.get("module_id")),
                            _optional_text(placement.get("module_name")),
                            _optional_text(placement.get("module_item_id")),
                            placement.get("position"),
                            _optional_text(placement.get("label")),
                            timestamp,
                        ),
                    )

                cursor = connection.execute(
                    """
                    SELECT *
                    FROM material_placements
                    WHERE course_id = ? AND material_key = ?
                    ORDER BY position, id
                    """,
                    (course_id, material_key),
                )
                replaced_placements[material_key] = [
                    _row_to_dict(row) for row in cursor.fetchall()
                ]

            return replaced_placements

    def set_consent_state(
        self,
        *,
        course_id: str,
        consent_granted: bool,
    ) -> CatalogRow:
        timestamp = self._timestamp()

        with self.connect() as connection:
            connection.execute(
                """
                UPDATE courses
                SET consent_granted = ?, updated_at = ?
                WHERE id = ?
                """,
                (1 if consent_granted else 0, timestamp, course_id),
            )
            return _select_course_by_id(connection, course_id)

    def update_course_vector_store(
        self,
        *,
        course_id: str,
        vector_store_id: str,
        expires_at: str | None,
        sync_status: str = "pending",
    ) -> CatalogRow:
        timestamp = self._timestamp()

        with self.connect() as connection:
            connection.execute(
                """
                UPDATE courses
                SET
                    vector_store_id = ?,
                    last_active_at = ?,
                    expires_at = ?,
                    sync_status = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    _required_text(vector_store_id, "vector_store_id"),
                    timestamp,
                    _optional_text(expires_at),
                    _required_text(sync_status, "sync_status"),
                    timestamp,
                    course_id,
                ),
            )
            return _select_course_by_id(connection, course_id)

    def set_active_generation(
        self,
        *,
        course_id: str,
        generation_id: str,
        sync_status: str = "pending",
    ) -> CatalogRow:
        timestamp = self._timestamp()

        with self.connect() as connection:
            connection.execute(
                """
                UPDATE courses
                SET
                    active_generation_id = ?,
                    sync_status = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    _required_text(generation_id, "generation_id"),
                    _required_text(sync_status, "sync_status"),
                    timestamp,
                    course_id,
                ),
            )
            return _select_course_by_id(connection, course_id)

    def mark_course_sync_status(
        self,
        *,
        course_id: str,
        sync_status: str,
        last_synced_at: str | None = None,
    ) -> CatalogRow:
        timestamp = self._timestamp()

        with self.connect() as connection:
            connection.execute(
                """
                UPDATE courses
                SET
                    sync_status = ?,
                    last_synced_at = COALESCE(?, last_synced_at),
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    _required_text(sync_status, "sync_status"),
                    _optional_text(last_synced_at),
                    timestamp,
                    course_id,
                ),
            )
            return _select_course_by_id(connection, course_id)

    def mark_vector_store_setup_failed(
        self,
        *,
        course_id: str,
        generation_id: str | None = None,
    ) -> CatalogRow:
        timestamp = self._timestamp()

        with self.connect() as connection:
            connection.execute(
                """
                UPDATE courses
                SET
                    active_generation_id = COALESCE(?, active_generation_id),
                    sync_status = 'failed',
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    _optional_text(generation_id),
                    timestamp,
                    course_id,
                ),
            )
            return _select_course_by_id(connection, course_id)

    def mark_materials_skipped(
        self,
        *,
        course_id: str,
        material_keys: Sequence[str],
        error_type: str | None = None,
        error_message: str | None = None,
    ) -> list[CatalogRow]:
        timestamp = self._timestamp()
        unique_material_keys = list(dict.fromkeys(material_keys))
        if not unique_material_keys:
            return []

        with self.connect() as connection:
            for material_key in unique_material_keys:
                connection.execute(
                    """
                    UPDATE materials
                    SET
                        status = 'skipped',
                        error_type = ?,
                        error_message = ?,
                        updated_at = ?
                    WHERE course_id = ? AND material_key = ?
                    """,
                    (
                        _optional_text(error_type),
                        _safe_diagnostic_text(error_message),
                        timestamp,
                        course_id,
                        material_key,
                    ),
                )

            placeholders = ", ".join("?" for _ in unique_material_keys)
            cursor = connection.execute(
                f"""
                SELECT *
                FROM materials
                WHERE course_id = ? AND material_key IN ({placeholders})
                ORDER BY material_key
                """,
                (course_id, *unique_material_keys),
            )
            return [_row_to_dict(row) for row in cursor.fetchall()]

    def create_sync_run_placeholder(
        self,
        *,
        course_id: str,
        generation_id: str,
        status: str = "pending",
        warnings_json: str | None = None,
    ) -> CatalogRow:
        sync_run_id = _new_id("sync")
        timestamp = self._timestamp()

        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO sync_runs (
                    id,
                    course_id,
                    generation_id,
                    status,
                    warnings_json,
                    started_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    sync_run_id,
                    course_id,
                    generation_id,
                    status,
                    _safe_diagnostic_text(warnings_json),
                    timestamp,
                ),
            )
            cursor = connection.execute(
                "SELECT * FROM sync_runs WHERE id = ?",
                (sync_run_id,),
            )
            return _row_to_dict(cursor.fetchone())

    def _timestamp(self) -> str:
        timestamp = self._now()
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=UTC)

        return timestamp.astimezone(UTC).isoformat()


@contextmanager
def _open_catalog_connection(
    db_path: str | Path,
    *,
    initialize: bool = True,
) -> Iterator[sqlite3.Connection]:
    resolved_path = Path(db_path).expanduser().absolute()
    if initialize:
        initialize_schema(resolved_path)

    connection = sqlite3.connect(resolved_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")

    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _row_to_dict(row: sqlite3.Row | None) -> CatalogRow | None:
    if row is None:
        return None

    return dict(row)


def _select_course_by_id(connection: sqlite3.Connection, course_id: str) -> CatalogRow:
    cursor = connection.execute(
        "SELECT * FROM courses WHERE id = ?",
        (course_id,),
    )
    course = _row_to_dict(cursor.fetchone())
    if course is None:
        raise LookupError(f"Course row was not found after write: {course_id}")

    return course


def _select_course_by_hash(
    connection: sqlite3.Connection,
    course_key_hash: str,
) -> CatalogRow:
    cursor = connection.execute(
        "SELECT * FROM courses WHERE course_key_hash = ?",
        (course_key_hash,),
    )
    course = _row_to_dict(cursor.fetchone())
    if course is None:
        raise LookupError("Course row was not found after write")

    return course


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def _optional_text(value: object) -> str | None:
    if value is None:
        return None

    normalized = str(value).strip()
    return normalized or None


def _required_text(value: object, field_name: str) -> str:
    normalized = _optional_text(value)
    if normalized is None:
        raise ValueError(f"{field_name} is required")

    return normalized


def _safe_diagnostic_text(value: object) -> str | None:
    if _optional_text(value) is None:
        return None

    return DIAGNOSTIC_PLACEHOLDER
