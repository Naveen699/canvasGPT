import importlib
import logging
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.catalog.repository import CatalogRepository
from backend.config import load_config
from backend.logging_config import REDACTED, configure_logging, redact_for_logging


ENV_VARS = (
    "OPENAI_API_KEY",
    "OPENAI_RESPONSE_MODEL",
    "CANVASGPT_DB_PATH",
    "CANVASGPT_INDEX_RETENTION_DAYS",
    "CANVASGPT_MAX_FILE_BYTES",
    "CANVASGPT_LOG_LEVEL",
)


def test_redact_for_logging_masks_sensitive_keys_in_nested_payloads() -> None:
    payload = {
        "authorization": "Bearer auth-token",
        "Cookie": "canvas_session=secret",
        "token": "token-value",
        "api_key": "sk-test-secret",
        "fileDownloadUrl": "https://canvas.example.edu/files/1?verifier=abc",
        "body": "raw Canvas-native body",
        "nested": {
            "prompt": "raw user prompt",
            "safe": "status only",
        },
        "items": [
            {"accessToken": "secret-token"},
            {"title": "Syllabus"},
        ],
    }

    redacted = redact_for_logging(payload)

    assert redacted["authorization"] == REDACTED
    assert redacted["Cookie"] == REDACTED
    assert redacted["token"] == REDACTED
    assert redacted["api_key"] == REDACTED
    assert redacted["fileDownloadUrl"] == REDACTED
    assert redacted["body"] == REDACTED
    assert redacted["nested"]["prompt"] == REDACTED
    assert redacted["nested"]["safe"] == "status only"
    assert redacted["items"][0]["accessToken"] == REDACTED
    assert redacted["items"][1]["title"] == "Syllabus"


def test_redact_for_logging_masks_sensitive_values_and_file_bytes() -> None:
    assert redact_for_logging("Bearer abc.def.ghi") == REDACTED
    assert redact_for_logging("Authorization: Bearer abc") == REDACTED
    assert redact_for_logging("Cookie: canvas_session=secret") == REDACTED
    assert redact_for_logging("sk-testsecret123456") == REDACTED
    assert (
        redact_for_logging("https://canvas.example.edu/files/1/download?verifier=abc")
        == REDACTED
    )
    assert redact_for_logging(b"raw file bytes") == REDACTED
    assert redact_for_logging("ordinary lifecycle event") == "ordinary lifecycle event"


def test_configure_logging_uses_configured_level() -> None:
    configure_logging(load_config({"CANVASGPT_LOG_LEVEL": "debug"}))

    assert logging.getLogger().level == logging.DEBUG
    assert logging.getLogger("canvasgpt").level == logging.DEBUG


def test_configure_logging_redacts_structured_log_arguments(
    caplog: pytest.LogCaptureFixture,
) -> None:
    logger = logging.getLogger("canvasgpt.test")
    sensitive_token = "Bearer structured-secret"

    with caplog.at_level(logging.INFO):
        configure_logging(load_config({"CANVASGPT_LOG_LEVEL": "INFO"}))
        logger.info(
            "catalog lifecycle event %s",
            {"authorization": sensitive_token, "status": "started"},
        )

    assert REDACTED in caplog.text
    assert "started" in caplog.text
    assert sensitive_token not in caplog.text


def test_extract_and_repository_operations_do_not_log_payloads(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    for name in ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("CANVASGPT_DB_PATH", str(tmp_path / "private" / "catalog.sqlite3"))
    monkeypatch.setenv("CANVASGPT_LOG_LEVEL", "INFO")

    sys.modules.pop("backend.main", None)
    main = importlib.import_module("backend.main")

    raw_prompt = "raw prompt should never be logged"
    canvas_body = "raw Canvas-native body should never be logged"
    signed_url = "https://canvas.example.edu/files/1/download?verifier=signed-secret"
    cookie_value = "canvas_session=secret-cookie"
    bearer_value = "Bearer secret-token"

    with caplog.at_level(logging.INFO):
        with TestClient(main.app) as client:
            caplog.clear()
            client.post(
                "/extract",
                json={
                    "url": "https://canvas.example.edu/courses/123",
                    "title": "Course page",
                    "headings": [],
                    "links": [{"text": "file", "href": signed_url}],
                    "visibleText": f"{raw_prompt}\n{canvas_body}",
                },
                headers={
                    "Authorization": bearer_value,
                    "Cookie": cookie_value,
                },
            )

        repository = CatalogRepository(tmp_path / "repository" / "catalog.sqlite3")
        course = repository.get_or_create_course(
            canvas_origin="https://canvas.example.edu",
            course_id="123",
            canvas_user_id="456",
        )
        repository.upsert_material_placeholder(
            course_id=course["id"],
            material_key="file:1",
            kind="file",
            canvas_url=signed_url,
            error_message=raw_prompt,
        )

    assert raw_prompt not in caplog.text
    assert canvas_body not in caplog.text
    assert signed_url not in caplog.text
    assert cookie_value not in caplog.text
    assert bearer_value not in caplog.text
