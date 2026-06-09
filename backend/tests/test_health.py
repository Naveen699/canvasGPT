import importlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


ENV_VARS = (
    "OPENAI_API_KEY",
    "OPENAI_RESPONSE_MODEL",
    "CANVASGPT_DB_PATH",
    "CANVASGPT_INDEX_RETENTION_DAYS",
    "CANVASGPT_MAX_FILE_BYTES",
    "CANVASGPT_LOG_LEVEL",
)


def test_health_response_is_exact_without_openai_key(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for name in ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("CANVASGPT_DB_PATH", str(tmp_path / "private" / "health.sqlite3"))

    sys.modules.pop("backend.main", None)
    main = importlib.import_module("backend.main")

    with TestClient(main.app) as client:
        response = client.get("/health")

    assert main.app.state.config.openai_api_key is None
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
