import importlib
import logging
import sqlite3
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.catalog.schema import STAGE_1_TABLES


ENV_VARS = (
    "OPENAI_API_KEY",
    "OPENAI_RESPONSE_MODEL",
    "CANVASGPT_DB_PATH",
    "CANVASGPT_INDEX_RETENTION_DAYS",
    "CANVASGPT_MAX_FILE_BYTES",
    "CANVASGPT_LOG_LEVEL",
)


def test_health_response_is_exact_and_startup_needs_no_openai_key(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main, _db_path = _import_main(tmp_path, monkeypatch)

    with TestClient(main.app) as client:
        response = client.get("/health")

    assert main.app.state.config.openai_api_key is None
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_extract_endpoint_keeps_existing_behavior(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main, _db_path = _import_main(tmp_path, monkeypatch)
    payload = {
        "url": "https://canvas.example.edu/courses/123",
        "title": "Course home",
        "headings": ["Assignments", "Files"],
        "links": [
            {"text": "Syllabus", "href": "https://canvas.example.edu/syllabus"},
            {"text": "Week 1", "href": "https://canvas.example.edu/week-1"},
        ],
        "canvas": {
            "assignments": [{"text": "Essay", "href": "/assignments/1"}],
            "files": [{"text": "Slides", "href": "/files/1"}],
            "modules": [{"text": "Module 1", "href": "/modules/1"}],
            "dueDates": [{"text": "Essay due", "dateTime": "2026-06-09T12:00:00Z"}],
        },
        "visibleText": "x" * 600,
    }

    with TestClient(main.app) as client:
        response = client.post("/extract", json=payload)

    assert response.status_code == 200
    assert response.json() == {
        "message": "Data received successfully",
        "url": "https://canvas.example.edu/courses/123",
        "title": "Course home",
        "num_headings": 2,
        "num_links": 2,
        "num_assignments": 1,
        "num_files": 1,
        "num_modules": 1,
        "num_due_dates": 1,
        "text_preview": "x" * 500,
    }


def test_startup_creates_catalog_tables(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    main, db_path = _import_main(tmp_path, monkeypatch)

    assert not db_path.exists()
    with TestClient(main.app):
        pass

    assert db_path.is_file()
    with sqlite3.connect(db_path) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }

    assert set(STAGE_1_TABLES).issubset(tables)


def test_startup_logs_do_not_include_openai_key(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    secret = "sk-test-step-six-secret"
    main, _db_path = _import_main(
        tmp_path,
        monkeypatch,
        openai_api_key=secret,
        log_level="INFO",
    )

    with caplog.at_level(logging.INFO):
        with TestClient(main.app):
            pass

    assert "CanvasGPT backend startup complete" in caplog.text
    assert secret not in caplog.text
    assert "OPENAI_API_KEY" not in caplog.text


def _import_main(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    *,
    openai_api_key: str | None = None,
    log_level: str | None = None,
):
    for name in ENV_VARS:
        monkeypatch.delenv(name, raising=False)

    db_path = tmp_path / "private" / "canvasgpt.sqlite3"
    monkeypatch.setenv("CANVASGPT_DB_PATH", str(db_path))
    if openai_api_key is not None:
        monkeypatch.setenv("OPENAI_API_KEY", openai_api_key)
    if log_level is not None:
        monkeypatch.setenv("CANVASGPT_LOG_LEVEL", log_level)

    sys.modules.pop("backend.main", None)
    return importlib.import_module("backend.main"), db_path
