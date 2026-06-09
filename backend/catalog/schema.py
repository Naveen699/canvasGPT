import os
import sqlite3
import stat
from pathlib import Path


STAGE_1_TABLES = (
    "courses",
    "materials",
    "material_placements",
    "sync_runs",
)


class SchemaError(ValueError):
    """Raised when the catalog schema cannot be initialized safely."""


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,
    canvas_origin TEXT NOT NULL,
    course_id TEXT NOT NULL,
    course_name TEXT,
    canvas_user_id TEXT,
    local_profile_id TEXT,
    hosted_user_id TEXT,
    auth_subject TEXT,
    course_key_hash TEXT NOT NULL UNIQUE,
    vector_store_id TEXT,
    active_generation_id TEXT,
    consent_granted INTEGER NOT NULL DEFAULT 0,
    sync_status TEXT NOT NULL DEFAULT 'not_started',
    last_synced_at TEXT,
    last_active_at TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL,
    material_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT,
    canvas_url TEXT,
    canvas_updated_at TEXT,
    content_hash TEXT,
    size INTEGER,
    content_type TEXT,
    file_name TEXT,
    openai_file_id TEXT,
    vector_store_file_id TEXT,
    generation_id TEXT,
    status TEXT NOT NULL,
    error_type TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(course_id, material_key)
);

CREATE TABLE IF NOT EXISTS material_placements (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL,
    material_key TEXT NOT NULL,
    source_kind TEXT,
    module_id TEXT,
    module_name TEXT,
    module_item_id TEXT,
    position INTEGER,
    label TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL,
    generation_id TEXT NOT NULL,
    status TEXT NOT NULL,
    new_count INTEGER NOT NULL DEFAULT 0,
    changed_count INTEGER NOT NULL DEFAULT 0,
    unchanged_count INTEGER NOT NULL DEFAULT 0,
    indexed_count INTEGER NOT NULL DEFAULT 0,
    pending_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    warnings_json TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT
);
"""


def initialize_schema(db_path: str | Path) -> None:
    resolved_path = Path(db_path).expanduser().absolute()
    _reject_symlink_path(resolved_path)

    _ensure_private_parent_directory(resolved_path.parent)
    _reject_symlink_path(resolved_path)
    _ensure_private_db_file(resolved_path)

    with sqlite3.connect(resolved_path) as connection:
        connection.executescript(SCHEMA_SQL)

    resolved_path.chmod(0o600)


def _reject_symlink_path(path: Path) -> None:
    components = [path]
    current = path
    while current.parent != current:
        current = current.parent
        components.append(current)

    for component in reversed(components):
        if component.exists() or component.is_symlink():
            if component.is_symlink():
                raise SchemaError(f"Database path must not contain symlinks: {component}")


def _ensure_private_parent_directory(path: Path) -> None:
    if path.exists():
        mode = stat.S_IMODE(path.stat().st_mode)
        if mode & 0o077:
            raise SchemaError(
                f"Database directory must not be group- or world-accessible: {path}"
            )
        return

    missing_directories: list[Path] = []
    current = path
    while not current.exists():
        missing_directories.append(current)
        current = current.parent

    for directory in reversed(missing_directories):
        directory.mkdir(mode=0o700)
        directory.chmod(0o700)


def _ensure_private_db_file(path: Path) -> None:
    if path.exists():
        _validate_existing_db_file(path)
        return

    flags = os.O_CREAT | os.O_EXCL | os.O_RDWR
    flags |= getattr(os, "O_NOFOLLOW", 0)
    file_descriptor = os.open(path, flags, 0o600)
    os.close(file_descriptor)


def _validate_existing_db_file(path: Path) -> None:
    if not path.is_file():
        raise SchemaError(f"Database path must be a regular file: {path}")

    mode = stat.S_IMODE(path.stat().st_mode)
    if mode & 0o077:
        raise SchemaError(f"Database file must not be group- or world-accessible: {path}")

    with path.open("rb") as db_file:
        header = db_file.read(16)

    if header and header != b"SQLite format 3\x00":
        raise SchemaError(f"Database path is not a SQLite database: {path}")
